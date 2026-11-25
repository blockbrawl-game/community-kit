#!/usr/bin/env node
// The `brawl-modes` command line: new, dev, test, bench, check, build, publish, status.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bundleClient, bundleServer, hashText, isOffline, limits, loadMode } from './build.js';

const USAGE = `brawl-modes: build, test and check BlockBrawl community modes.

Usage:
  brawl-modes new <id> [--template turn|realtime|offline] [--name "Display name"]
  brawl-modes dev <mode> [--players N] [--bots N] [--port 5173] [--host 127.0.0.1] [--seed N]
  brawl-modes dev <mode> --remote [--gateway http://localhost:5121] [--players N] [--port 5173]
  brawl-modes test <mode> [--runs 20] [--seed N] [--record file.json] [--json]
  brawl-modes bench <mode> [--runs 10] [--seed N] [--json]
  brawl-modes check <mode> [--json]
  brawl-modes build <mode> [--out dir] [--json]
  brawl-modes publish <mode> [--server https://api.block-brawl.com] [--json]
  brawl-modes status [<submission> | <mode>] [--wait] [--json]

new      creates ./modes/<id> from a template that passes check (turn is the default; --offline is --template offline)
dev      plays the mode in the browser, every player side by side
test     fuzz, sync, determinism, hydration and size checks
bench    server cost in work units, the same on every machine, against the server's gates
check    everything review runs (policy, test, bench, build); a mode is ready when it prints READY TO SUBMIT
build    writes the built mode to <mode>/dist and prints the hashes a reviewer approves
publish  runs check, then uploads the mode's source to the game's registry for review (needs BRAWL_MODES_TOKEN)
status   your modes, one mode's submissions, or one submission (--wait until its check is done)

<mode> is a mode id under your ./modes folder, or a path to a mode folder.
A mode with "runtime": "offline" in mode.json has no server: dev serves only its client, test checks only its build.
--json prints the result as one JSON object on stdout (the report goes to stderr), for tools and AI assistants.
Docs: https://github.com/blockbrawl-game/community-kit/tree/main/docs`;

// Flags that never take a value, so `new --offline my-mode` keeps my-mode as the id.
const BOOLEAN_FLAGS = new Set(['json', 'offline', 'remote', 'help', 'wait', 'skip-check']);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) positional.push(argv[i]);
    else if (BOOLEAN_FLAGS.has(argv[i].slice(2))) flags[argv[i].slice(2)] = true;
    else flags[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
  }
  return { positional, flags };
}

function intFlag(value, name) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`--${name} must be an integer.`);
  return n;
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [command, modeName] = positional;

// With --json, stdout carries only the result object; everything the commands print goes to stderr.
const json = flags.json === true;
const printResult = console.log.bind(console);
if (json) console.log = console.error.bind(console);

try {
  if (command === 'status' && !flags.help) {
    const { runStatus } = await import('./publish.js');
    const report = {};
    const ok = await runStatus({ target: modeName, flags, report });
    if (json) printResult(JSON.stringify(report));
    process.exit(ok ? 0 : 1);
  }

  if (!command || !modeName || flags.help) {
    console.log(USAGE);
    process.exit(command ? 1 : 0);
  }

  if (command === 'new') {
    const { createMode, packageWarning } = await import('./new.js');
    const template = flags.offline === true ? 'offline' : typeof flags.template === 'string' ? flags.template : 'turn';
    const written = await createMode({ id: modeName, template, name: typeof flags.name === 'string' ? flags.name : undefined });
    console.log(`Created ${written.join(', ')} from the ${template} template.`);
    const warning = await packageWarning();
    if (warning) console.log(`Warning: ${warning}`);
    console.log(`\nNext:\n  npx brawl-modes check ${modeName}   # passes as generated; keep it passing\n  npx brawl-modes dev ${modeName}     # play it\nRead AGENTS.md for the rules and the workflow.`);
    if (json) printResult(JSON.stringify({ passed: true, id: modeName, template, written }));
    process.exit(0);
  }

  const offline = command === 'dev' || command === 'test' ? isOffline((await loadMode(modeName)).manifest) : false;

  if (command === 'dev' && offline) {
    if (flags.remote) throw new Error('An offline mode has no server match, so there is nothing to connect to with --remote.');
    const { startOfflineDevServer } = await import('./dev-offline.js');
    await startOfflineDevServer({ modeName, port: intFlag(flags.port, 'port') });
  } else if (command === 'test' && offline) {
    const mode = await loadMode(modeName);
    const bytes = Buffer.byteLength(await bundleClient(mode));
    const passed = bytes <= limits.maxClientBytes;
    console.log(`${passed ? 'ok  ' : 'FAIL'} client  ${bytes} bytes (limit ${limits.maxClientBytes})`);
    if (json) {
      printResult(JSON.stringify({
        passed,
        failures: passed ? [] : [`budget: built client is ${bytes} bytes (limit ${limits.maxClientBytes}).`],
        warnings: [],
        budgets: { clientBytes: bytes },
      }));
    }
    process.exit(passed ? 0 : 1);
  } else if (command === 'dev' && flags.remote) {
    const { startRemoteDevServer } = await import('./dev-remote.js');
    await startRemoteDevServer({
      modeName,
      port: intFlag(flags.port, 'port'),
      playerCount: intFlag(flags.players, 'players'),
      seed: intFlag(flags.seed, 'seed'),
      gateway: typeof flags.gateway === 'string' ? flags.gateway : undefined,
    });
  } else if (command === 'dev') {
    const { startDevServer } = await import('./dev-server.js');
    await startDevServer({
      modeName,
      port: intFlag(flags.port, 'port'),
      host: typeof flags.host === 'string' ? flags.host : undefined,
      playerCount: intFlag(flags.players, 'players'),
      bots: intFlag(flags.bots, 'bots'),
      seed: intFlag(flags.seed, 'seed'),
    });
  } else if (command === 'test') {
    const { runTests } = await import('./test.js');
    const report = {};
    const passed = await runTests({
      modeName,
      runs: intFlag(flags.runs, 'runs'),
      seed: intFlag(flags.seed, 'seed'),
      recordFile: typeof flags.record === 'string' ? flags.record : undefined,
      report,
    });
    if (json) printResult(JSON.stringify(report));
    process.exit(passed ? 0 : 1);
  } else if (command === 'check') {
    const { runCheck } = await import('./check.js');
    const report = {};
    const passed = await runCheck({ modeName, report });
    if (json) printResult(JSON.stringify(report));
    process.exit(passed ? 0 : 1);
  } else if (command === 'bench') {
    const { runBench } = await import('./bench.js');
    const report = {};
    const passed = await runBench({
      modeName,
      runs: intFlag(flags.runs, 'runs'),
      seed: intFlag(flags.seed, 'seed'),
      report,
    });
    if (json) printResult(JSON.stringify(report));
    process.exit(passed ? 0 : 1);
  } else if (command === 'publish') {
    const { runPublish } = await import('./publish.js');
    const report = {};
    const passed = await runPublish({ modeName, flags, report });
    if (json) printResult(JSON.stringify(report));
    process.exit(passed ? 0 : 1);
  } else if (command === 'build') {
    const mode = await loadMode(modeName);
    const outDir = path.resolve(typeof flags.out === 'string' ? flags.out : path.join(mode.dir, 'dist'));
    await mkdir(outDir, { recursive: true });
    const outputs = { 'client.html': await bundleClient(mode) };
    if (!isOffline(mode.manifest)) outputs['server.bundle.js'] = await bundleServer(mode);
    for (const [name, content] of Object.entries(outputs)) {
      await writeFile(path.join(outDir, name), content);
      console.log(`Wrote ${path.join(outDir, name)} (${Buffer.byteLength(content)} bytes).`);
    }
    // The values a reviewer pins in modes/approved.json; the server refuses content that does not match them.
    const key = `${mode.manifest.id}@${mode.manifest.version}`;
    const describe = (content) => ({ sha256: hashText(content), bytes: Buffer.byteLength(content) });
    const server = outputs['server.bundle.js'] === undefined ? null : describe(outputs['server.bundle.js']);
    const client = describe(outputs['client.html']);
    if (server) console.log(`Server bundle sha256 for ${key}: ${server.sha256}`);
    console.log(`Client sha256 for ${key}#client: ${client.sha256}`);
    if (json) {
      printResult(JSON.stringify({ id: mode.manifest.id, version: mode.manifest.version, outDir, server, client }));
    }
  } else {
    console.log(USAGE);
    process.exit(1);
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  if (json) printResult(JSON.stringify({ passed: false, error: error.message }));
  process.exit(1);
}
