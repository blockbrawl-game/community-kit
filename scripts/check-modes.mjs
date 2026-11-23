// CI gate for every mode under modes/: runs the dev kit tests, builds the server bundle and prints its hash
// (the value a maintainer pins in the game server's approval list), and refuses obviously hostile or unsupported code.
// Usage: node scripts/check-modes.mjs [mode-id ...]   (default: every folder in modes/)
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modesDir = join(root, 'modes');
const ids = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(modesDir).filter((d) => statSync(join(modesDir, d)).isDirectory());

// Things a mode never needs. The runtime also blocks them; failing early gives the author a clear message.
const forbidden = [
  [/\beval\s*\(/, 'eval'],
  [/\bnew\s+Function\s*\(/, 'Function constructor'],
  [/\bimport\s*\(/, 'dynamic import'],
  [/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/, 'network access'],
  [/\b(Worker|SharedWorker|ServiceWorker)\b/, 'workers'],
  [/\b(ArrayBuffer|SharedArrayBuffer|Uint8Array|Int32Array|Float32Array|Float64Array|DataView)\b/, 'typed arrays (removed in the server runtime)'],
  [/\bMath\.random\b/, 'Math.random (use ctx.rng so replays match)'],
];
const textFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'dist' || e.name === 'node_modules' ? [] : textFiles(p);
    return /\.(js|mjs|html|css|json)$/.test(e.name) ? [p] : [];
  });

let failed = false;
const fail = (id, msg) => { failed = true; console.error(`::error::${id}: ${msg}`); };

for (const id of ids) {
  const dir = join(modesDir, id);
  if (!existsSync(join(dir, 'mode.json'))) { fail(id, 'no mode.json'); continue; }
  const manifest = JSON.parse(readFileSync(join(dir, 'mode.json'), 'utf8'));
  if (manifest.id !== id) fail(id, `mode.json id "${manifest.id}" must equal the folder name`);
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? '')) fail(id, 'version must be x.y.z');

  // Forbidden APIs apply to the mode's own sources, not to tests. Math.random only breaks replays of a server match,
  // so an offline mode (client only, nothing replayed) may use it.
  const offline = manifest.runtime === 'offline';
  for (const file of textFiles(dir).filter((f) => !f.includes('/tests/'))) {
    const text = readFileSync(file, 'utf8');
    for (const [re, what] of forbidden) {
      if (offline && what.startsWith('Math.random')) continue;
      if (re.test(text)) fail(id, `${file.slice(root.length + 1)} uses ${what}`);
    }
  }

  for (const cmd of ['test', 'build']) {
    const r = spawnSync('node', ['devkit/cli.js', cmd, id], { cwd: root, encoding: 'utf8' });
    process.stdout.write(r.stdout ?? '');
    process.stderr.write(r.stderr ?? '');
    if (r.status !== 0) fail(id, `devkit ${cmd} failed`);
  }
}
if (failed) process.exit(1);
console.log(`checked ${ids.length} mode(s)`);
