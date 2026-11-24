// `brawl-modes new`: every template passes `check` as generated, and the agent guide and the schema stay in step
// with the code. Run with `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from '../devkit/build.js';
import { runCheck } from '../devkit/check.js';
import { TEMPLATES, createMode } from '../devkit/new.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function quiet(run) {
  const log = console.log;
  console.log = () => {};
  try {
    return await run();
  } finally {
    console.log = log;
  }
}

async function workspace(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'brawl-new-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

for (const template of TEMPLATES) {
  test(`the ${template} template passes check as generated`, async (t) => {
    const cwd = await workspace(t);
    await createMode({ id: `try-${template}`, template, cwd });
    const modeDir = path.join(cwd, 'modes', `try-${template}`);
    const report = {};
    const passed = await quiet(() => runCheck({ modeName: modeDir, report }));
    assert.equal(passed, true, `check failed: ${JSON.stringify(report.failed)} ${JSON.stringify(report.steps, null, 1).slice(0, 2000)}`);

    // No placeholder survives, and $schema points at the kit's schema file.
    const manifest = JSON.parse(await readFile(path.join(modeDir, 'mode.json'), 'utf8'));
    assert.equal(manifest.id, `try-${template}`);
    assert.equal(manifest.name, `Try ${template[0].toUpperCase()}${template.slice(1)}`);
    assert.ok(existsSync(path.resolve(modeDir, manifest.$schema)), `$schema ${manifest.$schema} does not exist`);
    for (const file of ['mode.json', 'README.md', 'client/index.html']) {
      assert.doesNotMatch(await readFile(path.join(modeDir, file), 'utf8'), /__[A-Z_]+__/, `${file} has a placeholder left`);
    }
  });
}

test('new writes the workspace files once and never overwrites them', async (t) => {
  const cwd = await workspace(t);
  const first = await createMode({ id: 'first-mode', cwd });
  assert.deepEqual(first, ['modes/first-mode/', 'AGENTS.md', 'CLAUDE.md', 'jsconfig.json', '.gitignore', 'package.json']);
  const second = await createMode({ id: 'second-mode', template: 'offline', name: 'Second', cwd });
  assert.deepEqual(second, ['modes/second-mode/']);

  assert.equal(await readFile(path.join(cwd, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  const pkg = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  const jsconfig = JSON.parse(await readFile(path.join(cwd, 'jsconfig.json'), 'utf8'));
  const [sdk] = jsconfig.compilerOptions.paths['@blockbrawl/mode-sdk/*'];
  assert.ok(existsSync(path.resolve(cwd, sdk.replace('*', 'types.d.ts'))), `jsconfig sdk path ${sdk} does not exist`);
  const manifest = JSON.parse(await readFile(path.join(cwd, 'modes', 'second-mode', 'mode.json'), 'utf8'));
  assert.equal(manifest.name, 'Second');
});

test('new refuses a bad id, an unknown template and an existing folder', async (t) => {
  const cwd = await workspace(t);
  await assert.rejects(createMode({ id: 'Bad_Id', cwd }), /not a valid mode id/);
  await assert.rejects(createMode({ id: 'good-id', template: 'chess', cwd }), /Unknown template/);
  await createMode({ id: 'good-id', cwd });
  await assert.rejects(createMode({ id: 'good-id', cwd }), /already exists/);
});

test('modes/AGENTS.md is the same guide new writes into a workspace', () => {
  assert.equal(
    readFileSync(path.join(root, 'modes', 'AGENTS.md'), 'utf8'),
    readFileSync(path.join(root, 'templates', 'workspace', 'AGENTS.md'), 'utf8'),
    'Edit one and copy it to the other.',
  );
});

test('the mode.json schema and validateManifest agree', () => {
  const schema = JSON.parse(readFileSync(path.join(root, 'schema', 'mode.schema.json'), 'utf8'));
  const limits = JSON.parse(readFileSync(path.join(root, 'runtime', 'limits.json'), 'utf8'));
  assert.equal(schema.properties.tickRate.maximum, limits.maxTickRate);

  // Every key the schema allows is accepted, and nothing else is.
  const allKeys = Object.fromEntries(Object.keys(schema.properties).map((key) => [key, undefined]));
  const problems = validateManifest({ ...allKeys, id: 'abc', name: 'A', version: '1.0.0', players: { min: 1, max: 1 }, tickRate: 0, server: 's', client: 'c', clientModel: 'm' });
  assert.deepEqual(problems.filter((p) => p.startsWith('unknown key')), []);
  assert.match(validateManifest({ tickrate: 1 }).join('\n'), /unknown key "tickrate"/);

  // The patterns match the ones the kit enforces.
  for (const [value, ok] of [['abc', true], ['ab', false], ['1abc', false], ['a-b-c', true], ['Abc', false]]) {
    assert.equal(new RegExp(schema.properties.id.pattern).test(value), ok, `schema id pattern on ${value}`);
    const idProblem = validateManifest({ id: value }).some((p) => p.startsWith('id '));
    assert.equal(!idProblem, ok, `validateManifest id rule on ${value}`);
  }
  assert.deepEqual(schema.properties.orientation.enum, ['portrait', 'landscape', 'any']);
  assert.match(validateManifest({ orientation: 'sideways' }).join('\n'), /orientation must be/);

  // Every example passes both.
  for (const id of ['duel-lite', 'tap-rush', 'tile-frenzy']) {
    const manifest = JSON.parse(readFileSync(path.join(root, 'modes', id, 'mode.json'), 'utf8'));
    for (const key of Object.keys(manifest)) assert.ok(key in schema.properties, `${id} uses ${key}, missing from the schema`);
  }
});
