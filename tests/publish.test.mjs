// `brawl-modes publish` and `status` against a stand-in for the game's registry. Run with `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createMode } from '../devkit/new.js';
import { packMode, runPublish, runStatus, sourceFiles } from '../devkit/publish.js';

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
  const dir = await mkdtemp(path.join(os.tmpdir(), 'brawl-publish-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A registry stand-in that records what it was sent and answers like the gateway. */
async function fakeRegistry(t, answer) {
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      const [status, body] = answer(req);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, seen };
}

const submission = (state, extra = {}) => ({
  id: 'sub_00112233aabbccdd', modeId: 'my-mode', version: '1.0.0', state, failures: [], reviewNote: '', log: [], ...extra,
});

test('the archive is the source only, mode.json at its root, and tar reads it', async (t) => {
  const cwd = await workspace(t);
  await createMode({ id: 'my-mode', cwd });
  const dir = path.join(cwd, 'modes', 'my-mode');
  await writeFile(path.join(dir, '.secret'), 'not shipped');
  await quiet(() => spawnSync(process.execPath, [path.resolve('devkit/cli.js'), 'build', dir], { cwd }));

  const files = await sourceFiles(dir);
  assert.ok(files.includes('mode.json') && files.includes('client/index.html'));
  assert.ok(!files.some((f) => f.startsWith('dist/') || f.startsWith('.')), files.join(', '));

  const { archive } = await packMode(dir);
  const archivePath = path.join(cwd, 'out.tar.gz');
  await writeFile(archivePath, archive);
  const listed = spawnSync('tar', ['-tzf', archivePath], { encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(listed.stdout.trim().split('\n').sort(), [...files].sort());

  // The same source always packs to the same bytes.
  assert.deepEqual((await packMode(dir)).archive, archive);
  assert.ok(gunzipSync(archive).length % 512 === 0);
});

test('publish checks, then uploads with the token, and reports the submission', async (t) => {
  const cwd = await workspace(t);
  await createMode({ id: 'my-mode', cwd });
  const registry = await fakeRegistry(t, () => [202, submission('Checking')]);
  process.env.BRAWL_MODES_TOKEN = 'bbm_0123456789ab_' + 'a'.repeat(43);
  t.after(() => delete process.env.BRAWL_MODES_TOKEN);

  const report = {};
  const passed = await quiet(() => runPublish({ modeName: path.join(cwd, 'modes', 'my-mode'), flags: { server: registry.url }, report }));

  assert.equal(passed, true);
  assert.equal(report.submission.state, 'Checking');
  const [upload] = registry.seen;
  assert.equal(upload.method, 'POST');
  assert.equal(upload.url, '/api/creator/modes/my-mode/versions');
  assert.equal(upload.headers.authorization, `Bearer ${process.env.BRAWL_MODES_TOKEN}`);
  assert.equal(upload.headers['content-type'], 'application/gzip');
  assert.ok(gunzipSync(upload.body).includes(Buffer.from('mode.json')));
});

test('publish refuses a mode that fails check, without uploading', async (t) => {
  const cwd = await workspace(t);
  await createMode({ id: 'my-mode', cwd });
  const shared = path.join(cwd, 'modes', 'my-mode', 'shared.js');
  await writeFile(shared, `${await readFile(shared, 'utf8')}\nexport const roll = () => Math.random();\n`);
  const registry = await fakeRegistry(t, () => [202, submission('Checking')]);
  process.env.BRAWL_MODES_TOKEN = 'bbm_0123456789ab_' + 'a'.repeat(43);
  t.after(() => delete process.env.BRAWL_MODES_TOKEN);

  const report = {};
  const passed = await quiet(() => runPublish({ modeName: path.join(cwd, 'modes', 'my-mode'), flags: { server: registry.url }, report }));

  assert.equal(passed, false);
  assert.match(report.error, /policy/);
  assert.equal(registry.seen.length, 0);
});

test('publish passes on the server\'s refusal, and needs a token', async (t) => {
  const cwd = await workspace(t);
  await createMode({ id: 'my-mode', cwd });
  const registry = await fakeRegistry(t, () => [409, { error: 'my-mode@1.0.0 was already submitted. Raise "version" in mode.json.' }]);
  const modeName = path.join(cwd, 'modes', 'my-mode');

  delete process.env.BRAWL_MODES_TOKEN;
  await assert.rejects(quiet(() => runPublish({ modeName, flags: { server: registry.url, 'skip-check': true } })), /BRAWL_MODES_TOKEN/);

  process.env.BRAWL_MODES_TOKEN = 'bbm_0123456789ab_' + 'a'.repeat(43);
  t.after(() => delete process.env.BRAWL_MODES_TOKEN);
  await assert.rejects(quiet(() => runPublish({ modeName, flags: { server: registry.url, 'skip-check': true } })), /Raise "version"/);
});

test('status --wait polls until the check is done', async (t) => {
  let calls = 0;
  const registry = await fakeRegistry(t, (req) => {
    assert.equal(req.url, '/api/creator/submissions/sub_00112233aabbccdd');
    calls++;
    return [200, calls < 2 ? submission('Checking') : submission('ReadyForReview', { bench: { maxCallUnits: 10, unitsPerSecond: 20 } })];
  });
  process.env.BRAWL_MODES_TOKEN = 'bbm_0123456789ab_' + 'a'.repeat(43);
  t.after(() => delete process.env.BRAWL_MODES_TOKEN);

  const report = {};
  const ok = await quiet(() => runStatus({ target: 'sub_00112233aabbccdd', flags: { server: registry.url, wait: true }, report }));
  assert.equal(ok, true);
  assert.equal(report.submission.state, 'ReadyForReview');
  assert.equal(calls, 2);
});
