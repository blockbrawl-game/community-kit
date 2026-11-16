// `devkit test`: the checks every mode must pass before review.
//
//   fuzz         random matches driven by the mode's own action generator plus garbage input;
//                the mode must never throw, and a rejected action must not change state
//   sync         a client that joins through sync() must end up identical to one that saw every step
//   determinism  replaying the recorded inputs reproduces the exact same output
//   hydration    the same replay, but moving to a fresh sandbox along the way, must also match;
//                this fails when a mode keeps data outside `state`
//   budgets      bundle size, state size, batch size, call time, bytes per second
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleClient, bundleServer, limits, loadMode } from './build.js';
import { MatchHost, devPlayers } from './match.js';

const MAX_ITERATIONS = 4000;
const GARBAGE = [null, 42, 'x', [], {}, { t: 'nope' }, { t: 'place' }, { t: 'move', dx: 99 }, { t: 'place', i: -1, x: 1e9, y: 'a' }, { t: 'x'.repeat(8000) }];

function makeRng(seed) {
  let s = seed | 0;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (array) => array[Math.floor(next() * array.length)],
    shuffle(array) {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    },
  };
}

/** Returns the path of the first difference between two JSON values, or null if they are equal. */
function firstDiff(a, b, at = '$') {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return `${at}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${at}: array vs object`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const diff = firstDiff(a[key], b[key], Array.isArray(a) ? `${at}[${key}]` : `${at}.${key}`);
    if (diff) return diff;
  }
  return null;
}

class TestFailure extends Error {}

function fuzzRun({ mode, bundle, createModel, nextAction, seed, playerCount }) {
  const { manifest } = mode;
  const rng = makeRng(seed ^ 0x9e3779b9);
  const players = devPlayers(playerCount);
  const clients = new Map(players.map((p) => [p.id, { model: createModel(), lastSeq: -1, synced: false, rejected: new Set() }]));
  const counts = { actions: 0, rejected: 0, garbage: 0, syncChecks: 0 };

  const host = new MatchHost({
    manifest,
    bundle,
    players,
    seed,
    onSend(playerId, message) {
      const client = clients.get(playerId);
      if (message.kind === 'steps') {
        if (!client.synced) return;
        if (message.seq !== client.lastSeq + 1) throw new Error(`Dev kit bug: sequence gap for ${playerId}.`);
        client.lastSeq = message.seq;
        client.model.applySteps(message);
      } else if (message.kind === 'rejected') {
        client.rejected.add(message.actionId);
        client.model.onRejected?.(message.actionId, message.reason);
      }
    },
  });

  function checkSync(playerId, when) {
    const fresh = createModel();
    const message = host.buildSync(playerId);
    fresh.applySync(message.steps, message.info);
    counts.syncChecks++;
    const diff = firstDiff(clients.get(playerId).model.snapshot(), fresh.snapshot());
    if (diff) {
      throw new TestFailure(
        `sync: a client that joined through sync() differs from one that saw every step (${when}).\n` +
        `      first difference (live vs synced): ${diff}\n` +
        '      Either sync() leaves something out, or a step does not carry a change that state received.',
      );
    }
  }

  // State and random generator, without the match clock (which moves on even for a rejected action).
  function stateAndRng() {
    const snapshot = JSON.parse(host.exportState());
    return JSON.stringify([snapshot.state, snapshot.rng]);
  }

  function act(playerId, action, isGarbage) {
    const client = clients.get(playerId);
    const actionId = `f${counts.actions++}`;
    const before = stateAndRng();
    host.action(playerId, actionId, action, host.timeMs);
    if (isGarbage) counts.garbage++;
    if (client.rejected.has(actionId)) {
      counts.rejected++;
      if (stateAndRng() !== before) {
        throw new TestFailure(`fuzz: a rejected action changed state. Validate before mutating. Action: ${JSON.stringify(action)}`);
      }
    }
  }

  host.start();
  for (const [playerId, client] of clients) {
    const message = host.buildSync(playerId);
    client.lastSeq = message.seq;
    client.model.applySync(message.steps, message.info);
    client.synced = true;
  }

  const dtMs = manifest.tickRate > 0 ? 1000 / manifest.tickRate : 100;
  let forfeitUsed = false;
  let iterations = 0;
  for (; iterations < MAX_ITERATIONS && !host.ended; iterations++) {
    if (manifest.tickRate > 0) host.tick(dtMs);
    else host.timeMs += dtMs;

    for (const player of rng.shuffle([...players])) {
      if (host.ended) break;
      if (rng.next() < 0.6) {
        const action = nextAction(clients.get(player.id).model, player.id, rng);
        if (action !== null && action !== undefined) act(player.id, action, false);
      }
    }
    if (!host.ended && rng.next() < 0.03) act(rng.pick(players).id, rng.pick(GARBAGE), true);
    if (!host.ended && rng.next() < 0.005) {
      const id = rng.pick(players).id;
      host.setStatus(id, 'disconnected');
      host.setStatus(id, 'reconnected');
    }
    if (!host.ended && !forfeitUsed && players.length > 1 && rng.next() < 0.0015) {
      forfeitUsed = true;
      host.setStatus(rng.pick(players).id, 'forfeited');
    }
    if (rng.next() < 0.03) checkSync(rng.pick(players).id, `iteration ${iterations}`);
    if (iterations % 50 === 0) host.checkStateSize();
  }

  host.checkStateSize();
  for (const player of players) checkSync(player.id, 'end of match');

  if (host.result) {
    const flat = host.result.ranking?.flat?.() ?? [];
    const ids = players.map((p) => p.id);
    if (flat.length !== ids.length || !ids.every((id) => flat.includes(id))) {
      throw new TestFailure(`result: ranking must list every player exactly once. Got ${JSON.stringify(host.result.ranking)}`);
    }
  }

  return { host, players, counts, iterations, finished: host.ended };
}

function replay({ mode, bundle, players, seed, inputs, hydrateEvery }) {
  const host = new MatchHost({ manifest: mode.manifest, bundle, players, seed });
  host.start();
  inputs.forEach((input, index) => {
    if (hydrateEvery && index > 0 && index % hydrateEvery === 0) host.hydrate();
    if (input.op === 'action') host.action(input.playerId, input.actionId, input.action, input.timeMs);
    else if (input.op === 'tick') host.tick(input.dtMs);
    else if (input.op === 'status') host.setStatus(input.playerId, input.status);
  });
  return { outputHash: host.outputHash, stateHash: host.stateHash() };
}

function percentile(sorted, p) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
}

export async function runTests({ modeName, runs = 20, seed = 1, recordFile }) {
  const mode = await loadMode(modeName);
  const { manifest } = mode;
  console.log(`Testing ${manifest.id} ${manifest.version}\n`);

  const failures = [];
  const warnings = [];
  const pass = (text) => console.log(`  ok    ${text}`);
  const fail = (text) => { failures.push(text); console.log(`  FAIL  ${text}`); };
  const warn = (text) => { warnings.push(text); console.log(`  warn  ${text}`); };

  // Build and size budgets.
  let bundle;
  let clientBytes;
  try {
    bundle = await bundleServer(mode);
    clientBytes = Buffer.byteLength(await bundleClient(mode));
  } catch (error) {
    fail(`build: ${error.message}`);
    return false;
  }
  if (bundle.length > limits.maxServerBundleBytes) fail(`budget: server bundle is ${bundle.length} bytes (limit ${limits.maxServerBundleBytes}).`);
  else if (clientBytes > limits.maxClientBytes) fail(`budget: built client is ${clientBytes} bytes (limit ${limits.maxClientBytes}).`);
  else pass(`build: server bundle ${bundle.length} bytes, client ${clientBytes} bytes`);

  if (!manifest.fuzz) {
    fail('fuzz: mode.json has no "fuzz" file. Export nextAction(model, playerId, rng) so the mode can be tested.');
    return false;
  }
  const { createModel } = await import(pathToFileURL(path.join(mode.dir, manifest.clientModel)).href);
  const { nextAction } = await import(pathToFileURL(path.join(mode.dir, manifest.fuzz)).href);
  if (typeof createModel !== 'function') { fail(`client model: ${manifest.clientModel} must export createModel().`); return false; }
  if (typeof nextAction !== 'function') { fail(`fuzz: ${manifest.fuzz} must export nextAction().`); return false; }

  const callTimes = [];
  const totals = { actions: 0, rejected: 0, garbage: 0, syncChecks: 0, unfinished: 0, maxStateBytes: 0, maxBatchBytes: 0, bytesPerSecond: [] };
  const completed = [];

  for (let run = 0; run < runs; run++) {
    const runSeed = seed + run;
    const playerCount = run % 2 === 0 ? manifest.players.max : manifest.players.min;
    try {
      const outcome = fuzzRun({ mode, bundle, createModel, nextAction, seed: runSeed, playerCount });
      const { host, counts } = outcome;
      callTimes.push(...host.sandbox.callTimes);
      totals.actions += counts.actions;
      totals.rejected += counts.rejected;
      totals.garbage += counts.garbage;
      totals.syncChecks += counts.syncChecks;
      totals.maxStateBytes = Math.max(totals.maxStateBytes, host.stats.maxStateBytes);
      totals.maxBatchBytes = Math.max(totals.maxBatchBytes, host.stats.maxBatchBytes);
      if (host.timeMs > 0) totals.bytesPerSecond.push(host.stats.bytesSent / (host.timeMs / 1000) / playerCount);
      if (!outcome.finished) totals.unfinished++;
      completed.push({ seed: runSeed, players: outcome.players, inputs: host.inputs, outputHash: host.outputHash, stateHash: host.stateHash() });
    } catch (error) {
      const prefix = error instanceof TestFailure ? '' : 'fuzz: ';
      fail(`${prefix}${error.message}\n      reproduce: devkit test ${modeName} --seed ${runSeed} --runs 1`);
      if (error.details?.stack) console.log(`      ${String(error.details.stack).split('\n').slice(0, 4).join('\n      ')}`);
      break;
    }
  }

  if (failures.length === 0) {
    pass(`fuzz: ${runs} matches, ${totals.actions} actions (${totals.rejected} rejected, ${totals.garbage} garbage), no throws`);
    pass(`sync: ${totals.syncChecks} late-join comparisons matched`);
    if (totals.unfinished > 0) warn(`${totals.unfinished} of ${runs} matches did not finish within ${MAX_ITERATIONS} iterations.`);

    let deterministic = true;
    let hydrates = true;
    for (const run of completed) {
      const args = { mode, bundle, players: run.players, seed: run.seed, inputs: run.inputs };
      try {
        const again = replay(args);
        if (again.outputHash !== run.outputHash || again.stateHash !== run.stateHash) deterministic = false;
        const moved = replay({ ...args, hydrateEvery: 37 });
        if (moved.outputHash !== run.outputHash || moved.stateHash !== run.stateHash) hydrates = false;
      } catch (error) {
        hydrates = false;
        console.log(`      replay threw: ${error.message}`);
      }
      if (!deterministic || !hydrates) {
        if (!deterministic) fail(`determinism: replaying seed ${run.seed} produced different output.`);
        else fail(`hydration: seed ${run.seed} diverged after moving to a fresh sandbox. The mode keeps match data outside \`state\` (module-level variables?).`);
        break;
      }
    }
    if (deterministic) pass(`determinism: ${completed.length} replays identical`);
    if (deterministic && hydrates) pass(`hydration: ${completed.length} replays identical across sandbox restarts`);

    callTimes.sort((a, b) => a - b);
    const p50 = percentile(callTimes, 0.5);
    const p99 = percentile(callTimes, 0.99);
    const rate = totals.bytesPerSecond.length ? totals.bytesPerSecond.reduce((a, b) => a + b, 0) / totals.bytesPerSecond.length : 0;
    console.log('\n  Budgets');
    console.log(`    call time      p50 ${p50.toFixed(2)} ms, p99 ${p99.toFixed(2)} ms   (hard limit ${limits.maxCallMs} ms)`);
    console.log(`    state size     max ${totals.maxStateBytes} bytes              (limit ${limits.maxStateBytes})`);
    console.log(`    step batch     max ${totals.maxBatchBytes} bytes              (limit ${limits.maxBatchBytes})`);
    console.log(`    bandwidth      ${Math.round(rate)} bytes/s per player (JSON, before transport encoding)`);
    if (p99 > limits.warnCallP99Ms) warn(`call time p99 is above ${limits.warnCallP99Ms} ms.`);

    if (recordFile && completed.length > 0 && failures.length === 0) {
      const first = completed[0];
      const file = path.resolve(recordFile);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify({
        format: 1,
        modeId: manifest.id,
        version: manifest.version,
        seed: first.seed,
        players: first.players,
        limits: { maxStepsPerCall: limits.maxStepsPerCall },
        inputs: first.inputs,
        expect: { outputHash: first.outputHash, stateHash: first.stateHash },
      }));
      console.log(`\n  Recorded seed ${first.seed} (${first.inputs.length} inputs) to ${file}`);
    }
  }

  console.log(failures.length === 0
    ? `\nPASSED${warnings.length ? ` with ${warnings.length} warning(s)` : ''}`
    : `\nFAILED (${failures.length})`);
  return failures.length === 0;
}
