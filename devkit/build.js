// Locates, validates and bundles a mode package.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const communityRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const limits = JSON.parse(await readFile(path.join(communityRoot, 'runtime', 'limits.json'), 'utf8'));

const ID_PATTERN = /^[a-z][a-z0-9-]{2,31}$/;

/** Accepts a mode id (looked up in community/modes) or a path to a mode folder. */
export function resolveModeDir(nameOrPath) {
  const candidates = [
    path.resolve(nameOrPath),
    path.join(communityRoot, 'modes', nameOrPath),
    path.join(communityRoot, 'devkit', 'fixtures', nameOrPath),
  ];
  const found = candidates.find((dir) => existsSync(path.join(dir, 'mode.json')));
  if (!found) throw new Error(`Mode "${nameOrPath}" not found (no mode.json in ${candidates.join(', ')}).`);
  return found;
}

export async function loadMode(nameOrPath) {
  const dir = resolveModeDir(nameOrPath);
  const manifest = JSON.parse(await readFile(path.join(dir, 'mode.json'), 'utf8'));
  const problems = validateManifest(manifest, dir);
  if (problems.length > 0) {
    throw new Error(`Invalid mode.json in ${dir}:\n  - ${problems.join('\n  - ')}`);
  }
  return { dir, manifest };
}

export function validateManifest(manifest, dir) {
  const problems = [];
  if (!ID_PATTERN.test(manifest.id ?? '')) problems.push('id must be 3-32 chars: lowercase letters, digits, dashes.');
  if (dir && path.basename(dir) !== manifest.id) problems.push(`folder name must equal id ("${manifest.id}").`);
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? '')) problems.push('version must be semver, for example 1.0.0.');
  if (typeof manifest.name !== 'string' || manifest.name.length === 0) problems.push('name is required.');
  const { min, max } = manifest.players ?? {};
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > 8) {
    problems.push('players must be { min, max } with 1 <= min <= max <= 8.');
  }
  if (!Number.isInteger(manifest.tickRate) || manifest.tickRate < 0 || manifest.tickRate > limits.maxTickRate) {
    problems.push(`tickRate must be an integer from 0 to ${limits.maxTickRate}.`);
  }
  for (const key of ['server', 'client', 'clientModel']) {
    if (typeof manifest[key] !== 'string') problems.push(`${key} is required.`);
    else if (dir && !existsSync(path.join(dir, manifest[key]))) problems.push(`${key} file "${manifest[key]}" does not exist.`);
  }
  if (manifest.fuzz && dir && !existsSync(path.join(dir, manifest.fuzz))) problems.push(`fuzz file "${manifest.fuzz}" does not exist.`);
  return problems;
}

/** Bundles server.js and everything it imports into one script that defines `globalThis.__bbMode`. */
export async function bundleServer(mode) {
  const result = await build({
    entryPoints: [path.join(mode.dir, mode.manifest.server)],
    // esbuild writes source paths into the bundle relative to this folder. Anchoring it makes the bundle, and so
    // the hash a reviewer approves, the same whichever folder the build is started from.
    absWorkingDir: communityRoot,
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__bbMode',
    platform: 'neutral',
    target: 'es2022',
    alias: { '@blockbrawl/mode-sdk': path.join(communityRoot, 'sdk') },
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

const ASSET_LOADERS = {
  '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.gif': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl',
  '.mp3': 'dataurl', '.ogg': 'dataurl', '.wav': 'dataurl', '.woff2': 'dataurl', '.css': 'text',
};

function attribute(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match ? match[1] ?? match[2] ?? match[3] : null;
}

function localFile(clientDir, modeDir, reference) {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(reference)) {
    throw new Error(`Client references external resource "${reference}". Everything must be part of the mode package.`);
  }
  const file = path.resolve(clientDir, reference);
  if (!file.startsWith(modeDir + path.sep)) throw new Error(`Client references "${reference}" outside the mode folder.`);
  return file;
}

/**
 * Builds the mode client into one self-contained HTML document: module scripts are bundled and
 * inlined, stylesheets are inlined, and imported assets become data URIs. The mode frame has no
 * network access at all, so this document is everything the client will ever have.
 */
export async function bundleClient(mode) {
  const htmlPath = path.join(mode.dir, mode.manifest.client);
  const clientDir = path.dirname(htmlPath);
  let html = await readFile(htmlPath, 'utf8');

  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    if ((attribute(tag, 'rel') ?? '').toLowerCase() !== 'stylesheet') continue;
    const css = await readFile(localFile(clientDir, mode.dir, attribute(tag, 'href') ?? ''), 'utf8');
    html = html.replace(tag, () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`);
  }

  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  for (const [whole, attrs, body] of scripts) {
    const src = attribute(attrs, 'src');
    const isModule = (attribute(attrs, 'type') ?? '').toLowerCase() === 'module';
    let code;
    if (isModule) {
      const result = await build({
        ...(src
          ? { entryPoints: [localFile(clientDir, mode.dir, src)] }
          : { stdin: { contents: body, resolveDir: clientDir, sourcefile: 'index.html', loader: 'js' } }),
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        alias: { '@blockbrawl/mode-sdk': path.join(communityRoot, 'sdk') },
        loader: ASSET_LOADERS,
        logLevel: 'silent',
      });
      code = result.outputFiles[0].text;
    } else if (src) {
      code = await readFile(localFile(clientDir, mode.dir, src), 'utf8');
    } else {
      continue;
    }
    const open = isModule ? '<script type="module">' : '<script>';
    html = html.replace(whole, () => `${open}\n${code.replace(/<\/script/gi, '<\\/script')}</script>`);
  }
  return html;
}
