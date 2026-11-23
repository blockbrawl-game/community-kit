// Source rules a mode must follow. The server's sandbox blocks most of these at runtime too; checking the
// source first gives a clear message instead of a failed match.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const FORBIDDEN = [
  [/\beval\s*\(/, 'eval'],
  [/\bnew\s+Function\s*\(/, 'the Function constructor'],
  [/\bimport\s*\(/, 'dynamic import'],
  [/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/, 'network access'],
  [/\b(Worker|SharedWorker|ServiceWorker)\b/, 'workers'],
  [/\b(ArrayBuffer|SharedArrayBuffer|Uint8Array|Int32Array|Float32Array|Float64Array|DataView)\b/, 'typed arrays (removed in the server runtime)'],
  [/\bMath\.random\b/, 'Math.random (use ctx.rng so replays match)'],
];

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return ['dist', 'node_modules', 'tests'].includes(entry.name) ? [] : sourceFiles(full);
    return /\.(js|mjs|html|css|json)$/.test(entry.name) ? [full] : [];
  });
}

/** Returns one message per broken rule; empty when the mode follows them all. Tests are exempt. */
export function checkPolicy(mode) {
  const { manifest, dir } = mode;
  const problems = [];
  // Math.random only breaks replays of a server match, so an offline mode (client only) may use it.
  const offline = manifest.runtime === 'offline';
  for (const file of sourceFiles(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const [pattern, what] of FORBIDDEN) {
      if (offline && what.startsWith('Math.random')) continue;
      if (pattern.test(text)) problems.push(`${path.relative(dir, file)} uses ${what}`);
    }
  }
  return problems;
}
