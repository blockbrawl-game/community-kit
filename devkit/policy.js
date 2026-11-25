// Source rules a mode must follow. The server's sandbox blocks most of these at runtime too; checking the
// source first gives a clear message instead of a failed match.
//
// There are two rule sets, because the two halves of a mode run in different places:
//
// - **Server rules** apply to every file the server bundle or the client model imports (`server`, `shared.js`,
//   `clientModel` and what they import). That code runs in the server sandbox, or must replay identically in
//   `test`, so it may not use typed arrays, Math.random or garbage collection timing.
// - **Client rules** apply to the rest of the client (rendering, input, effects). It runs in the browser frame,
//   where the CSP blocks network, workers and eval anyway; typed arrays (WebGL needs them) and Math.random (for
//   visual effects) are fine there.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { communityRoot } from './build.js';

const ALWAYS = [
  [/\beval\s*\(/, 'eval'],
  [/\bnew\s+Function\s*\(/, 'the Function constructor'],
  [/\bimport\s*\(/, 'dynamic import'],
  [/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/, 'network access'],
  [/\b(Worker|SharedWorker|ServiceWorker)\b/, 'workers'],
];

const SERVER_ONLY = [
  [/\b(ArrayBuffer|SharedArrayBuffer|Uint8Array|Int32Array|Float32Array|Float64Array|DataView)\b/, 'typed arrays (removed in the server runtime)'],
  [/\bMath\.random\b/, 'Math.random (use ctx.rng so replays match)'],
  [/\b(WeakRef|FinalizationRegistry)\b/, 'WeakRef or FinalizationRegistry (garbage collection timing is not deterministic; removed in the server runtime)'],
];

/** Every rule, for the server side and the client model. */
export const FORBIDDEN = [...ALWAYS, ...SERVER_ONLY];
/** The rules for client files that neither the server nor the client model imports. */
export const FORBIDDEN_IN_CLIENT = ALWAYS;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return ['dist', 'node_modules', 'tests'].includes(entry.name) ? [] : sourceFiles(full);
    return /\.(js|mjs|html|css|json)$/.test(entry.name) ? [full] : [];
  });
}

/**
 * The mode's own files that `entry` imports, directly or not. Returns null when the entry does not build: then
 * every file gets the server rules, and the build step reports the error.
 */
async function importedFiles(dir, entry) {
  try {
    const result = await build({
      entryPoints: [path.join(dir, entry)],
      absWorkingDir: dir,
      bundle: true,
      write: false,
      metafile: true,
      format: 'esm',
      platform: 'neutral',
      alias: { '@blockbrawl/mode-sdk': path.join(communityRoot, 'sdk') },
      loader: { '.json': 'json' },
      logLevel: 'silent',
    });
    return Object.keys(result.metafile.inputs)
      .map((input) => path.resolve(dir, input))
      .filter((file) => file.startsWith(dir + path.sep));
  } catch {
    return null;
  }
}

/** The files the server rules apply to, or null for "all of them". */
export async function serverSideFiles(mode) {
  const { manifest, dir } = mode;
  const entries = manifest.runtime === 'offline' ? [] : [manifest.server, manifest.clientModel].filter((e) => typeof e === 'string');
  const files = new Set();
  for (const entry of entries) {
    const imported = await importedFiles(dir, entry);
    if (!imported) return null;
    for (const file of imported) files.add(file);
  }
  return files;
}

/** Returns one message per broken rule; empty when the mode follows them all. Tests are exempt. */
export async function checkPolicy(mode) {
  const { manifest, dir } = mode;
  const problems = [];
  // An offline mode has no server and no replays: its whole client follows the client rules.
  const offline = manifest.runtime === 'offline';
  const serverSide = offline ? new Set() : await serverSideFiles(mode);
  for (const file of sourceFiles(dir)) {
    const text = readFileSync(file, 'utf8');
    const strict = serverSide === null || serverSide.has(file);
    for (const [pattern, what] of strict ? FORBIDDEN : FORBIDDEN_IN_CLIENT) {
      if (pattern.test(text)) problems.push(`${path.relative(dir, file)} uses ${what}${strict && !offline && SERVER_ONLY.some(([p]) => p === pattern) ? ' (it is imported by the server or the client model)' : ''}`);
    }
  }
  return problems;
}
