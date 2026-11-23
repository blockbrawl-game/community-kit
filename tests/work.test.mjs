// Unit tests for the work-unit instrumenter and the counting sandbox. Run with `node --test tests/`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { instrument } from '../devkit/work.js';
import { Sandbox } from '../devkit/sandbox.js';

function run(source) {
  let units = 0;
  const result = new Function('W', `${instrument(source, 'W')}\nreturn typeof out === 'undefined' ? undefined : out;`)(() => units++);
  return { units, result };
}

test('counts one unit per function call and per loop pass', () => {
  const { units, result } = run('function f(k){let s=0; for(let i=0;i<k;i++){ s+=[1,2].map(v=>v).length } return s} var out = f(5);');
  assert.equal(result, 10);
  assert.equal(units, 1 + 5 + 10); // f, 5 loop passes, 2 map callbacks per pass
});

test('covers every loop form and expression-bodied arrows without changing results', () => {
  const src = `
    var out = [];
    let i = 0; while (i < 3) i++;
    do i--; while (i > 0);
    for (const k in {a: 1, b: 2}) out.push(k);
    for (const v of [1, 2, 3]) out.push(v);
    const add = a => b => a + b;
    out.push(add(1)(2));
    out.push((() => ({ x: 1 }))().x);
    class C { m() { return 7 } static s = () => 8 }
    out.push(new C().m(), C.s());`;
  const { units, result } = run(src);
  assert.deepEqual(result, ['a', 'b', 1, 2, 3, 3, 1, 7, 8]);
  // 3 while + 3 do-while + 2 for-in + 3 for-of + 2 add calls + 1 arrow + m + s (+ field initializer)
  assert.ok(units >= 16, `units ${units}`);
});

test('the same input always gives the same count', () => {
  const src = 'var out = 0; for (let i = 0; i < 1000; i++) out += [3,1,2].sort((a, b) => a - b)[0];';
  assert.equal(run(src).units, run(src).units);
});

test('a mode can neither read nor reset the counter', () => {
  // The bundle defines __bbMode the way esbuild output does; the prelude needs a valid mode.
  const bundle = `
    var __bbMode = { default: {
      setup() { return { n: 0 }; },
      onAction(state) {
        for (const name of Object.getOwnPropertyNames(globalThis)) {
          if (name.startsWith('__bbWork_')) { try { globalThis[name] = () => {}; } catch {} try { delete globalThis[name]; } catch {} }
        }
        for (let i = 0; i < 100; i++) state.n++;
      },
      sync() { return []; },
      result() { return null; },
    } };`;
  const sandbox = new Sandbox(bundle, { countWork: true });
  sandbox.call('setup', { players: [{ id: 'a', name: 'A', isBot: false }], seed: 1, limits: { maxStepsPerCall: 256 } });
  sandbox.call('action', { playerId: 'a', action: {}, timeMs: 0 });
  sandbox.call('action', { playerId: 'a', action: {}, timeMs: 0 });
  const actions = sandbox.work.filter((w) => w.fn === 'action').map((w) => w.units);
  assert.equal(actions.length, 2);
  assert.ok(actions[1] >= 100, `second action still counted: ${actions[1]}`);
});
