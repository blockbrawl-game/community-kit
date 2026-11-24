// CI gate for every mode under modes/: runs `brawl-modes check` (policy, test, bench, build) on each one and
// prints the hashes a maintainer approves in the game. With --baseline it also requires each mode's bench
// numbers to equal scripts/bench-baseline.json exactly: the work units are meant to be the same on every
// machine, and this proves it on every CI run. `--update-baseline` rewrites the file after a deliberate change.
// Usage: node scripts/check-modes.mjs [--baseline | --update-baseline] [mode-id ...]
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modesDir = join(root, 'modes');
const baselineFile = join(root, 'scripts', 'bench-baseline.json');
const args = process.argv.slice(2);
const compare = args.includes('--baseline');
const update = args.includes('--update-baseline');
const named = args.filter((a) => !a.startsWith('--'));
const ids = named.length ? named : readdirSync(modesDir).filter((d) => statSync(join(modesDir, d)).isDirectory()).sort();

const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) : {};
let failed = false;
const fail = (id, msg) => { failed = true; console.error(`::error::${id}: ${msg}`); };

for (const id of ids) {
  const r = spawnSync('node', ['devkit/cli.js', 'check', id, '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  process.stderr.write(r.stderr ?? '');
  let report;
  try { report = JSON.parse(r.stdout); } catch { fail(id, 'check produced no result'); continue; }
  if (!report.passed) fail(id, `check failed: ${report.failed.join(', ')}`);
  for (const [name, hash] of Object.entries(report.steps.build?.hashes ?? {})) console.log(`${name}: ${hash}`);

  const bench = report.steps.bench ?? {};
  const numbers = bench.offline ? { offline: true } : { maxCallUnits: bench.maxCallUnits, unitsPerSecond: bench.unitsPerSecond, perPlayer: bench.perPlayer };
  if (update) baseline[id] = numbers;
  else if (compare) {
    if (!baseline[id]) fail(id, 'not in scripts/bench-baseline.json; run with --update-baseline');
    else if (JSON.stringify(baseline[id]) !== JSON.stringify(numbers)) {
      fail(id, `bench numbers ${JSON.stringify(numbers)} differ from the baseline ${JSON.stringify(baseline[id])}. Work units must be identical on every machine.`);
    }
  }
}

if (update) {
  writeFileSync(baselineFile, JSON.stringify(Object.fromEntries(Object.entries(baseline).sort()), null, 2) + '\n');
  console.log(`updated ${baselineFile}`);
}
if (failed) process.exit(1);
console.log(`checked ${ids.length} mode(s)`);
