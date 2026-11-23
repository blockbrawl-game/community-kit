// Work units: a machine-independent measure of how much a mode's server code does.
//
// The bundled server script is rewritten so that every function call and every loop iteration
// calls a counter first. One unit is one function entry or one loop pass. The count depends
// only on the mode's code and its inputs, never on the machine, so the same match gives the
// same number on a laptop, in CI and on the review server.
//
// What it does not see: work done inside built-ins without a callback (a long `indexOf`, a big
// `JSON.stringify`, string building). State size and step batch size are measured separately,
// and the server keeps its wall-clock watchdog as the last line of defence.
import { parse } from 'acorn';
import { randomBytes } from 'node:crypto';

const LOOPS = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** A counter name no mode can guess or shadow, fixed per sandbox. */
export function counterName() {
  return `__bbWork_${randomBytes(6).toString('hex')}`;
}

/**
 * Returns `source` with a call to `counter()` at the start of every function body and every loop
 * body. Throws if the source does not parse (the build already produced it, so it always should).
 */
export function instrument(source, counter) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  const call = `${counter}();`;
  // [position, text, close, depth]: openings go left of what they wrap, closings right.
  const inserts = [];

  (function visit(node, depth) {
    if (!node || typeof node.type !== 'string') return;

    if (FUNCTIONS.has(node.type)) {
      if (node.body.type === 'BlockStatement') {
        inserts.push([node.body.start + 1, call, false, depth]);
      } else {
        // `x => expr`: count, then evaluate the expression.
        inserts.push([node.body.start, `(${counter}(), `, false, depth]);
        inserts.push([node.body.end, ')', true, depth]);
      }
    } else if (LOOPS.has(node.type)) {
      if (node.body.type === 'BlockStatement') {
        inserts.push([node.body.start + 1, call, false, depth]);
      } else {
        inserts.push([node.body.start, `{${call}`, false, depth]);
        inserts.push([node.body.end, '}', true, depth]);
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range') continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach((child) => visit(child, depth + 1));
      else if (value && typeof value.type === 'string') visit(value, depth + 1);
    }
  })(ast, 0);

  // At one position: closings first, innermost first; then openings, outermost first.
  const order = (a, b) => (a[2] !== b[2] ? (a[2] ? -1 : 1) : a[2] ? b[3] - a[3] : a[3] - b[3]);
  inserts.sort((a, b) => a[0] - b[0] || order(a, b));
  let out = '';
  let last = 0;
  for (const [pos, text] of inserts) {
    out += source.slice(last, pos) + text;
    last = pos;
  }
  out += source.slice(last);
  return out;
}
