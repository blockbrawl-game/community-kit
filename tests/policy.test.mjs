// The source policy: server-side code (what the server bundle and the client model import) follows every rule;
// the rest of the client may use typed arrays and Math.random. Run with `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadMode, bundleClient } from '../devkit/build.js';
import { createMode } from '../devkit/new.js';
import { checkPolicy } from '../devkit/policy.js';

async function turnMode(t) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'brawl-policy-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const log = console.log;
  console.log = () => {};
  try {
    await createMode({ id: 'policy-try', template: 'turn', cwd });
  } finally {
    console.log = log;
  }
  return path.join(cwd, 'modes', 'policy-try');
}

test('client-only files may use typed arrays and Math.random', async (t) => {
  const dir = await turnMode(t);
  await writeFile(path.join(dir, 'client', 'fx.js'), 'export const buf = new Float32Array(4); export const jitter = () => Math.random();\n');
  assert.deepEqual(await checkPolicy(await loadMode(dir)), []);
});

test('the client model and the server follow the server rules', async (t) => {
  const dir = await turnMode(t);
  await appendFile(path.join(dir, 'client', 'model.js'), '\nexport const noise = () => Math.random();\n');
  await appendFile(path.join(dir, 'shared.js'), '\nexport const scratch = new Uint8Array(2);\n');
  const problems = await checkPolicy(await loadMode(dir));
  assert.ok(problems.some((p) => p.startsWith(path.join('client', 'model.js')) && /Math\.random/.test(p)), problems.join('\n'));
  assert.ok(problems.some((p) => p.startsWith('shared.js') && /typed arrays/.test(p)), problems.join('\n'));
});

test('network, eval and workers are refused in client files too', async (t) => {
  const dir = await turnMode(t);
  await writeFile(path.join(dir, 'client', 'net.js'), 'export const go = () => fetch("x"); export const w = () => new Worker("y");\n');
  const problems = await checkPolicy(await loadMode(dir));
  assert.equal(problems.length, 2, problems.join('\n'));
});

test('the kit PixiJS build bundles into a mode client', async (t) => {
  const dir = await turnMode(t);
  await writeFile(path.join(dir, 'client', 'gfx.js'), "import { Application } from '@blockbrawl/mode-sdk/pixi';\nexport const make = () => new Application();\n");
  await appendFile(path.join(dir, 'client', 'index.html'), '<script type="module">import { make } from "./gfx.js"; globalThis.__make = make;</script>\n');
  const html = await bundleClient(await loadMode(dir));
  assert.match(html, /PixiJS 8\.\d+\.\d+/);
  assert.deepEqual(await checkPolicy(await loadMode(dir)), []);
});
