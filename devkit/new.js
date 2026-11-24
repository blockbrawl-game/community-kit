// `brawl-modes new <id>`: creates modes/<id> from a template that passes `check` as generated, and the files an
// editor or an AI assistant needs next to it (AGENTS.md, CLAUDE.md, jsconfig.json) when they are missing.
import { existsSync } from 'node:fs';
import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ID_PATTERN, communityRoot } from './build.js';

export const TEMPLATES = ['turn', 'realtime', 'offline'];

const templatesDir = path.join(communityRoot, 'templates');
const TEXT_FILE = /\.(js|mjs|json|html|css|md)$/;

/** "coin-chase" -> "Coin Chase". */
function titleCase(id) {
  return id.split('-').filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}

/** A relative path with forward slashes, as JSON files and import maps expect on every OS. */
function relative(from, to) {
  const rel = path.relative(from, to).split(path.sep).join('/');
  return rel === '' ? '.' : rel;
}

async function fillPlaceholders(dir, values) {
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !TEXT_FILE.test(entry.name)) continue;
    const file = path.join(entry.parentPath ?? entry.path, entry.name);
    const text = await readFile(file, 'utf8');
    const filled = text.replace(/__([A-Z_]+)__/g, (whole, key) => values[key] ?? whole);
    if (filled !== text) await writeFile(file, filled);
  }
}

/**
 * Creates the mode. Returns the list of files written (relative to `cwd`); throws with a message a person or an
 * agent can act on when the id, template or target folder is wrong.
 */
export async function createMode({ id, template = 'turn', name, cwd = process.cwd() }) {
  if (!ID_PATTERN.test(id ?? '')) {
    throw new Error(`"${id}" is not a valid mode id: use 3-32 chars, lowercase letters, digits and dashes, starting with a letter (for example coin-chase).`);
  }
  if (!TEMPLATES.includes(template)) throw new Error(`Unknown template "${template}". Choose one of: ${TEMPLATES.join(', ')}.`);
  const root = path.resolve(cwd);
  const modeDir = path.join(root, 'modes', id);
  if (existsSync(modeDir)) throw new Error(`${relative(root, modeDir)} already exists. Pick another id, or delete the folder first.`);

  const written = [];
  await cp(path.join(templatesDir, template), modeDir, { recursive: true });
  await fillPlaceholders(modeDir, {
    MODE_ID: id,
    MODE_NAME: name || titleCase(id),
    SCHEMA: relative(modeDir, path.join(communityRoot, 'schema', 'mode.schema.json')),
  });
  written.push(`modes/${id}/`);

  // The kit's own repository has its own AGENTS.md, CLAUDE.md and jsconfig.json at the root.
  if (root !== communityRoot) {
    const workspace = path.join(templatesDir, 'workspace');
    const files = { 'AGENTS.md': 'AGENTS.md', 'CLAUDE.md': 'CLAUDE.md', 'jsconfig.json': 'jsconfig.json', '.gitignore': 'gitignore' };
    for (const [target, source] of Object.entries(files)) {
      if (existsSync(path.join(root, target))) continue;
      const text = await readFile(path.join(workspace, source), 'utf8');
      const kit = relative(root, communityRoot);
      await writeFile(path.join(root, target), text.replace(/__KIT__/g, kit.startsWith('.') ? kit : `./${kit}`));
      written.push(target);
    }
    const packageFile = path.join(root, 'package.json');
    if (!existsSync(packageFile)) {
      const pkg = {
        name: path.basename(root).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-modes',
        private: true,
        type: 'module',
        scripts: { dev: 'brawl-modes dev', check: 'brawl-modes check', test: 'brawl-modes test', bench: 'brawl-modes bench' },
      };
      await writeFile(packageFile, `${JSON.stringify(pkg, null, 2)}\n`);
      written.push('package.json');
    }
  }
  return written;
}

/** Prints what the type of the workspace's package.json means for the mode, if it is not ESM. */
export async function packageWarning(cwd = process.cwd()) {
  const file = path.join(path.resolve(cwd), 'package.json');
  if (!existsSync(file) || path.resolve(cwd) === communityRoot) return null;
  const pkg = JSON.parse(await readFile(file, 'utf8'));
  return pkg.type === 'module'
    ? null
    : 'package.json has no "type": "module". Mode files are ES modules; add it so node loads them without a warning.';
}
