#!/usr/bin/env node
// Dev kit command line: dev, test, build.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bundleClient, bundleServer, loadMode } from './build.js';

const USAGE = `Usage:
  devkit dev <mode> [--players N] [--port 5173] [--seed N]
  devkit dev <mode> --remote [--gateway http://localhost:5121] [--players N] [--port 5173]
  devkit test <mode> [--runs 20] [--seed N] [--record file.json]
  devkit build <mode> [--out dir]

<mode> is a mode id under community/modes, or a path to a mode folder.`;

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

try {
  if (!command || !modeName || flags.help) {
    console.log(USAGE);
    process.exit(command ? 1 : 0);
  }

  if (command === 'dev' && flags.remote) {
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
    const passed = await runTests({
      modeName,
      runs: intFlag(flags.runs, 'runs'),
      seed: intFlag(flags.seed, 'seed'),
      recordFile: typeof flags.record === 'string' ? flags.record : undefined,
    });
    process.exit(passed ? 0 : 1);
  } else if (command === 'build') {
    const mode = await loadMode(modeName);
    const outDir = path.resolve(typeof flags.out === 'string' ? flags.out : path.join(mode.dir, 'dist'));
    await mkdir(outDir, { recursive: true });
    const outputs = { 'server.bundle.js': await bundleServer(mode), 'client.html': await bundleClient(mode) };
    for (const [name, content] of Object.entries(outputs)) {
      await writeFile(path.join(outDir, name), content);
      console.log(`Wrote ${path.join(outDir, name)} (${Buffer.byteLength(content)} bytes).`);
    }
    // The value a maintainer pins in the game server's approval list; the server refuses a bundle that does not match it.
    const hash = createHash('sha256').update(outputs['server.bundle.js'], 'utf8').digest('hex');
    console.log(`Server bundle sha256 for ${mode.manifest.id}@${mode.manifest.version}: ${hash}`);
  } else {
    console.log(USAGE);
    process.exit(1);
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
