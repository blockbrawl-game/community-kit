// Builds sdk/pixi.js: PixiJS bundled into one ES module that works inside the mode frame.
//
// The mode frame's CSP has no 'unsafe-eval', so the bundle includes pixi.js/unsafe-eval, which replaces Pixi's
// generated functions with plain ones. Everything Pixi loads lazily is bundled in, so it never fetches code.
// The output is checked in: modes import it as '@blockbrawl/mode-sdk/pixi', it is part of every mode client that
// imports it, and so of that client's hash. Rebuild only with a deliberate version bump (see CHANGELOG.md):
//
//   npm i -D --save-exact pixi.js@<version> && node scripts/vendor-pixi.mjs
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(path.join(root, 'node_modules/pixi.js/package.json'), 'utf8'));

const result = await build({
  stdin: {
    contents: "import 'pixi.js/unsafe-eval';\nexport * from 'pixi.js';\n",
    resolveDir: root,
    sourcefile: 'pixi-entry.js',
  },
  absWorkingDir: root,
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});

const license = readFileSync(path.join(root, 'node_modules/pixi.js/LICENSE'), 'utf8').trim();
const header = `/*! PixiJS ${version} with pixi.js/unsafe-eval, bundled for BlockBrawl mode clients by scripts/vendor-pixi.mjs.\n${license}\n*/\n`;
writeFileSync(path.join(root, 'sdk/pixi.js'), header + result.outputFiles[0].text);
console.log(`sdk/pixi.js: PixiJS ${version}, ${(header.length + result.outputFiles[0].text.length) / 1024 | 0} KB`);
