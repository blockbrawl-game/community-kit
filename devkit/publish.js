// `brawl-modes publish` and `brawl-modes status`: submit a mode version to the game's mode registry and follow it.
//
// publish runs `check` first (the server runs the same one, so a failing mode would only use up a submission),
// packs the mode's source (not dist/, node_modules/ or hidden files) as a .tar.gz and uploads it with the creator
// token from BRAWL_MODES_TOKEN. The server builds and checks it in isolation; a person reviews and plays it; when
// it is approved it goes live without a game release.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { loadMode } from './build.js';

export const DEFAULT_SERVER = 'https://api.block-brawl.com';

const SKIP = new Set(['dist', 'node_modules']);

/** Every file of the mode that is part of its source: relative paths with forward slashes, sorted. */
export async function sourceFiles(dir) {
  const files = [];
  async function walk(current, prefix) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name.startsWith('.')) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!(prefix === '' && SKIP.has(entry.name))) await walk(path.join(current, entry.name), rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }
  await walk(dir, '');
  return files;
}

function octal(value, length) {
  return value.toString(8).padStart(length - 1, '0') + '\0';
}

/** One ustar header block. Paths longer than 100 bytes go into the prefix field, split at a slash. */
function header(name, size) {
  const block = Buffer.alloc(512);
  let prefix = '';
  let base = name;
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 155);
    if (cut <= 0 || Buffer.byteLength(name.slice(cut + 1)) > 100) throw new Error(`Path too long for the archive: ${name}`);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
  }
  block.write(base, 0, 100, 'utf8');
  block.write(octal(0o644, 8), 100, 'ascii');
  block.write(octal(0, 8), 108, 'ascii');
  block.write(octal(0, 8), 116, 'ascii');
  block.write(octal(size, 12), 124, 'ascii');
  block.write(octal(0, 12), 136, 'ascii'); // a fixed time, so the same source gives the same archive
  block.fill(' ', 148, 156);
  block.write('0', 156, 'ascii');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
  block.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(octal(sum, 7) + ' ', 148, 'ascii');
  return block;
}

/** The mode's source as a .tar.gz with mode.json at its root, the shape the registry accepts. */
export async function packMode(dir) {
  const parts = [];
  const files = await sourceFiles(dir);
  for (const file of files) {
    const data = await readFile(path.join(dir, file));
    parts.push(header(file, data.length), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return { archive: gzipSync(Buffer.concat(parts), { level: 9 }), files };
}

function serverUrl(flags) {
  const url = typeof flags.server === 'string' ? flags.server : process.env.BRAWL_MODES_SERVER || DEFAULT_SERVER;
  return url.replace(/\/$/, '');
}

function token() {
  const value = process.env.BRAWL_MODES_TOKEN;
  if (!value) {
    throw new Error('Set BRAWL_MODES_TOKEN to your creator token (bbm_...). Keep it out of your code and your shell history: put it in an environment variable or your CI secrets.');
  }
  return value;
}

async function request(flags, method, route, body, contentType) {
  const url = `${serverUrl(flags)}${route}`;
  const bearer = token();
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${bearer}`, ...(contentType ? { 'Content-Type': contentType } : {}) },
      body,
    });
  } catch (error) {
    throw new Error(`Could not reach ${url}: ${error.cause?.message ?? error.message}`);
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text.slice(0, 300) };
  }
  if (!response.ok) throw new Error(data?.error ?? `${method} ${route}: HTTP ${response.status}`);
  return data;
}

function describe(s) {
  const lines = [`${s.id}  ${s.modeId}@${s.version}  ${s.state}`];
  if (s.bench && !s.bench.offline && s.bench.maxCallUnits != null) {
    lines.push(`  bench: most expensive call ${s.bench.maxCallUnits} units, ${s.bench.unitsPerSecond} units per match-second`);
  }
  for (const failure of s.failures ?? []) lines.push(`  - ${failure}`);
  if (s.reviewNote) lines.push(`  review: ${s.reviewNote}`);
  const last = s.log?.[s.log.length - 1];
  if (last) lines.push(`  ${last.atUtc}  ${last.text}`);
  return lines.join('\n');
}

const NEXT = {
  Checking: 'The server is building and checking it.',
  CheckFailed: 'Fix what failed (`brawl-modes check` locally shows the same) and publish again; the same version is fine.',
  ReadyForReview: 'It passed every check. A person will read and play it.',
  Approved: 'It is approved. Live modes reach players within a minute.',
  Rejected: 'Read the review note, change the mode, raise "version" in mode.json and publish again.',
  Superseded: 'A newer submission of this mode replaced it.',
};

/** `brawl-modes publish <mode>`: check, pack, upload. */
export async function runPublish({ modeName, flags, report = {} }) {
  const mode = await loadMode(modeName);
  const { manifest } = mode;

  if (!flags['skip-check']) {
    const { runCheck } = await import('./check.js');
    const checkReport = {};
    if (!(await runCheck({ modeName, report: checkReport }))) {
      Object.assign(report, { passed: false, error: `check failed: ${checkReport.failed.join(', ')}` });
      console.log('\nNot published: fix what `check` reports first. The server runs the same check.');
      return false;
    }
  }

  const { archive, files } = await packMode(mode.dir);
  console.log(`\nPublishing ${manifest.id}@${manifest.version}: ${files.length} files, ${archive.length} bytes, to ${serverUrl(flags)}`);
  const submission = await request(flags, 'POST', `/api/creator/modes/${manifest.id}/versions`, archive, 'application/gzip');
  console.log(describe(submission));
  console.log(`\n${NEXT[submission.state] ?? ''}\nFollow it with: npx brawl-modes status ${submission.id} --wait`);
  Object.assign(report, { passed: true, submission });
  return true;
}

/** `brawl-modes status [submission | mode]`: one submission, a mode's submissions, or your modes. */
export async function runStatus({ target, flags, report = {} }) {
  if (target && /^sub_[0-9a-f]+$/.test(target)) {
    let submission = await request(flags, 'GET', `/api/creator/submissions/${target}`);
    if (flags.wait) {
      const until = Date.now() + 20 * 60 * 1000;
      while (submission.state === 'Checking' && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        submission = await request(flags, 'GET', `/api/creator/submissions/${target}`);
      }
    }
    console.log(describe(submission));
    console.log(`\n${NEXT[submission.state] ?? ''}`);
    Object.assign(report, { submission });
    return submission.state !== 'CheckFailed' && submission.state !== 'Rejected';
  }

  if (target) {
    const list = await request(flags, 'GET', `/api/creator/modes/${target}/submissions`);
    if (list.length === 0) console.log(`No submissions of ${target} yet.`);
    for (const s of list) console.log(describe(s));
    Object.assign(report, { submissions: list });
    return true;
  }

  const me = await request(flags, 'GET', '/api/creator/me');
  console.log(`${me.name} (${me.id})`);
  if (me.modes.length === 0) console.log('No modes yet. Publish one with: npx brawl-modes publish <mode>');
  for (const m of me.modes) console.log(`  ${m.id.padEnd(32)} ${m.live ? `live ${m.live}` : 'not live'}${m.disabled ? ' (disabled)' : ''}`);
  Object.assign(report, me);
  return true;
}
