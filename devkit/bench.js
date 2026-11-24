// `brawl-modes bench`: how much server work a mode costs, in work units.
//
// The numbers are the same on every machine: the bench plays the same seeded matches as `test`
// (the mode's own nextAction plus garbage input, at the most and the fewest players), replays each
// one in an instrumented sandbox and counts. The review server runs this exact command, so a mode
// that passes here passes there.
//
// The cost of one call is
//   code units   one per function call and per loop pass in the mode's server code (devkit/work.js)
//   + workPerByte × bytes of JSON crossing the sandbox (the call's input and its output)
// Both terms are what a mode controls. The platform's fixed cost per call is not counted: the tick
// rate cap and the action rate limit already bound it.
//
// Two gates, from runtime/limits.json:
//   maxWorkPerCall    the most expensive single call (setup, action, tick, status, sync)
//   maxWorkPerSecond  the sustained cost of one match: tick cost per second of match time, plus
//                     every player sending actions at the server's rate limit (maxActionsPerSecond),
//                     each costing the 95th percentile action
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleServer, isOffline, limits, loadMode } from './build.js';
import { MatchHost } from './match.js';
import { fuzzRun } from './test.js';

function percentile(sorted, p) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, v) => sum + v, 0);
  return {
    count: sorted.length,
    mean: sorted.length ? Math.round(total / sorted.length) : 0,
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.length ? sorted[sorted.length - 1] : 0,
  };
}

/** Replays a recorded match in a counting sandbox. Returns the per-call work and the output hash. */
function countedReplay({ manifest, bundle, players, seed, inputs }) {
  // What each player is sent: batches and their bytes, as the server would send them today (one batch per call).
  const sent = { batches: 0, bytes: 0 };
  const onSend = (playerId, message) => {
    if (message.kind !== 'steps') return;
    sent.batches++;
    sent.bytes += JSON.stringify(message).length;
  };
  const host = new MatchHost({ manifest, bundle, players, seed, countWork: true, onSend });
  host.start();
  for (const input of inputs) {
    if (input.op === 'action') host.action(input.playerId, input.actionId, input.action, input.timeMs);
    else if (input.op === 'tick') host.tick(input.dtMs, input.timeMs);
    else if (input.op === 'status') host.setStatus(input.playerId, input.status);
  }
  // A join or reconnect costs one sync() per player; count one for each.
  for (const player of players) host.buildSync(player.id);
  return { work: host.sandbox.work, outputHash: host.outputHash, sent };
}

/**
 * Runs the bench and prints a report. Returns whether the mode is within both gates; when `report` is
 * given it is filled with the numbers (`bench --json`).
 */
export async function runBench({ modeName, runs = 10, seed = 1, report = {} }) {
  const mode = await loadMode(modeName);
  const { manifest } = mode;
  const gates = { maxWorkPerCall: limits.maxWorkPerCall, maxWorkPerSecond: limits.maxWorkPerSecond, workPerByte: limits.workPerByte };
  const cost = (w) => w.units + limits.workPerByte * w.bytes;
  console.log(`Benchmarking ${manifest.id} ${manifest.version} (work units; the same on every machine)\n`);

  if (isOffline(manifest)) {
    console.log('  An offline mode has no server code, so it costs the server nothing.');
    Object.assign(report, { passed: true, offline: true, gates, failures: [] });
    return true;
  }

  const bundle = await bundleServer(mode);
  const { createModel } = await import(pathToFileURL(path.join(mode.dir, manifest.clientModel)).href);
  const { nextAction } = await import(pathToFileURL(path.join(mode.dir, manifest.fuzz)).href);

  const byFn = new Map();
  let tickUnits = 0;
  let tickMs = 0;
  let countedUnits = 0;
  let codeUnits = 0;
  let dataBytes = 0;
  let playerSeconds = 0;
  const sentTotal = { batches: 0, bytes: 0 };
  const failures = [];

  for (let run = 0; run < runs; run++) {
    const runSeed = seed + run;
    const playerCount = run % 2 === 0 ? manifest.players.max : manifest.players.min;
    let recorded;
    try {
      recorded = fuzzRun({ mode, bundle, createModel, nextAction, seed: runSeed, playerCount });
    } catch (error) {
      failures.push(`run ${run} (seed ${runSeed}) failed before it could be measured: ${error.message}. Run \`brawl-modes test\` first.`);
      break;
    }
    const { host, players } = recorded;

    const counted = countedReplay({ manifest, bundle, players, seed: runSeed, inputs: host.inputs });
    // The counted run must do exactly what the real run did; anything else means the mode behaves
    // differently when measured, and its numbers would be worthless.
    if (counted.outputHash !== host.outputHash) {
      failures.push(`run ${run} (seed ${runSeed}): the measured replay produced different output than the real run. A mode must not depend on how it is run.`);
      break;
    }
    for (const w of counted.work) {
      if (!byFn.has(w.fn)) byFn.set(w.fn, []);
      byFn.get(w.fn).push(cost(w));
      countedUnits += cost(w);
      codeUnits += w.units;
      dataBytes += w.bytes;
    }
    let runMs = 0;
    for (const input of host.inputs) if (input.op === 'tick') runMs += input.dtMs;
    tickMs += runMs;
    playerSeconds += players.length * (runMs / 1000);
    sentTotal.batches += counted.sent.batches;
    sentTotal.bytes += counted.sent.bytes;
    tickUnits += counted.work.filter((w) => w.fn === 'tick').reduce((sum, w) => sum + cost(w), 0);
  }

  const calls = Object.fromEntries([...byFn].map(([fn, values]) => [fn, summarize(values)]));
  const maxCall = Math.max(0, ...Object.values(calls).map((c) => c.max));
  const tickPerSecond = tickMs > 0 ? Math.round(tickUnits / (tickMs / 1000)) : 0;
  const actionP95 = calls.action?.p95 ?? 0;
  const actionsPerSecond = manifest.players.max * limits.maxActionsPerSecond * actionP95;
  const perSecond = tickPerSecond + actionsPerSecond;
  const codeShare = countedUnits > 0 ? Math.round((100 * codeUnits) / countedUnits) : 0;
  // The server's capacity is players, so the same numbers per player: the sustained cost shared by the seats of a
  // full match, and what the fuzzed matches sent each player per second of match time.
  const perPlayer = {
    unitsPerSecond: Math.round(perSecond / manifest.players.max),
    batchesPerSecond: playerSeconds > 0 ? Math.round((100 * sentTotal.batches) / playerSeconds) / 100 : 0,
    bytesPerSecond: playerSeconds > 0 ? Math.round(sentTotal.bytes / playerSeconds) : 0,
  };

  if (failures.length === 0) {
    console.log('  cost per call (code units + ' + limits.workPerByte + ' × bytes in and out)');
    console.log('  call      count      mean      p95      p99      max');
    for (const [fn, c] of Object.entries(calls)) {
      console.log(`  ${fn.padEnd(8)}${String(c.count).padStart(7)}${String(c.mean).padStart(10)}${String(c.p95).padStart(9)}${String(c.p99).padStart(9)}${String(c.max).padStart(9)}`);
    }
    console.log('');
    const line = (ok, text) => console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${text}`);
    const callOk = maxCall <= gates.maxWorkPerCall;
    const secondOk = perSecond <= gates.maxWorkPerSecond;
    line(callOk, `most expensive call: ${maxCall} units (limit ${gates.maxWorkPerCall})`);
    line(secondOk, `sustained cost: ${perSecond} units per match-second (limit ${gates.maxWorkPerSecond})`);
    console.log(`        = ticks ${tickPerSecond}/s + ${manifest.players.max} players × ${limits.maxActionsPerSecond} actions/s × ${actionP95} (p95 action)`);
    if (!callOk) failures.push(`the most expensive call costs ${maxCall} units, over the limit of ${gates.maxWorkPerCall}. Spread the work over ticks or keep less state per call.`);
    if (!secondOk) failures.push(`one match costs ${perSecond} units per second, over the limit of ${gates.maxWorkPerSecond}. Lower the tick rate, do less per tick, or make actions cheaper.`);
    console.log(`\n  Of all cost: ${codeShare}% code, ${100 - codeShare}% data (${dataBytes} bytes over ${runs} matches).`);
    console.log(`  Per player: ${perPlayer.unitsPerSecond} units, ${perPlayer.batchesPerSecond} batches and ${perPlayer.bytesPerSecond} bytes sent per second.`);
  } else {
    for (const failure of failures) console.log(`  FAIL  ${failure}`);
  }

  const passed = failures.length === 0;
  console.log(passed ? '\nWITHIN BUDGET' : `\nOVER BUDGET (${failures.length})`);
  Object.assign(report, {
    passed,
    gates,
    maxCallUnits: maxCall,
    unitsPerSecond: perSecond,
    tickUnitsPerSecond: tickPerSecond,
    actionUnitsP95: actionP95,
    calls,
    codeShare,
    perPlayer,
    runs,
    seed,
    failures,
  });
  return passed;
}
