#!/usr/bin/env node
// Dev kit command line: dev, test, build.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bundleClient, bundleServer, hashText, isOffline, limits, loadMode } from './build.js';

const USAGE = `Usage:
  devkit dev <mode> [--players N] [--port 5173] [--seed N]
  devkit dev <mode> --remote [--gateway http://localhost:5121] [--players N] [--port 5173]
  devkit test <mode> [--runs 20] [--seed N] [--record file.json] [--json]
  devkit build <mode> [--out dir] [--json]
  devkit bench <mode> [--runs 10] [--seed N] [--json]
  devkit check <mode> [--json]

<mode> is a mode id under community/modes, or a path to a mode folder.
A mode with "runtime": "offline" in mode.json has no server: dev serves only its client, test checks only its build.
--json prints the result as one JSON object on stdout (the report goes to stderr), for tools and build servers.`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
    else positional.push(argv[i]);
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
  if (!command || !modeName || flags.help) {
    console.log(USAGE);
    process.exit(command ? 1 : 0);
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
      playerCount: intFlag(flags.players, 'players'),
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
