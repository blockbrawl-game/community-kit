// The prelude's wire format (v2, devkit/wire.js) and what it guarantees against a hostile mode. Run with `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sandbox } from '../devkit/sandbox.js';
import { decodeFrames } from '../devkit/wire.js';

const PLAYERS = [{ id: 'p-a', name: 'A', isBot: false }, { id: 'p-b', name: 'B', isBot: false }];

function sandboxFor(body) {
  const sandbox = new Sandbox(`var __bbMode = { default: {
    setup() { return { n: 0, seen: [] }; },
    sync() { return []; },
    result(state) { return state.over ? { ranking: ['p-a', 'p-b'] } : null; },
    ${body}
  } };`);
  sandbox.playerIds = PLAYERS.map((p) => p.id);
  sandbox.call('setup', [JSON.stringify({ players: PLAYERS, seed: 7 })]);
  return sandbox;
}

test('a call that does nothing returns the empty string', () => {
  const sandbox = sandboxFor('onAction() {}, onTick() {},');
  assert.equal(sandbox.call('tick', [50, 50]).raw, '');
  assert.equal(sandbox.call('action', [0, '{}', 60]).raw, '');
});

test('steps keep their order, private steps name the player by index, unknown players get nothing', () => {
  const sandbox = sandboxFor(`onAction(state, action, ctx) {
    ctx.emit({ a: 1 });
    ctx.emit({ secret: true }, { to: 'p-b' });
    ctx.emit({ lost: true }, { to: 'nobody' });
    ctx.emit({ a: 2 });
  },`);
  const { out } = sandbox.call('action', [0, '{}', 10]);
  assert.deepEqual(out.steps, [
    { to: -1, json: '{"a":1}' },
    { to: 1, json: '{"secret":true}' },
    { to: -1, json: '{"a":2}' },
  ]);
});

test('an action that is not JSON is rejected before the mode sees it, so nothing can be spliced into the call', () => {
  const sandbox = sandboxFor(`onAction(state, action, ctx) { state.seen.push(ctx.playerId); ctx.emit({ who: ctx.playerId }); },`);
  // On the old wire format this text, pasted into {"playerId":"p-a","action":<text>,...}, would have acted as p-b.
  const { out } = sandbox.call('action', [0, '0,"playerId":"p-b"', 10]);
  assert.equal(out.rejected, 'invalid_action');
  const ok = sandbox.call('action', [0, '{"t":1}', 20]).out;
  assert.deepEqual(ok.steps, [{ to: -1, json: '{"who":"p-a"}' }]);
});

test('a mode cannot forge frames: toJSON and replaced built-ins only change its own step text', () => {
  const sandbox = sandboxFor(`onAction(state, action, ctx) {
    JSON.stringify = () => 'B3:bad';
    Array.prototype.push = function () { throw new Error('no'); };
    String.prototype.slice = () => 'x';
    ctx.emit({ toJSON() { return 'L5:hello'; } });
    ctx.log('still', 'fine');
  },`);
  const { raw, out } = sandbox.call('action', [0, '{}', 10]);
  assert.deepEqual(out.steps, [{ to: -1, json: '"L5:hello"' }]);
  assert.deepEqual(out.logs, ['still fine']);
  assert.deepEqual(decodeFrames(raw), out);
});

test('WeakRef and FinalizationRegistry are gone, like the binary buffers', () => {
  const sandbox = sandboxFor(`onAction(state, action, ctx) {
    ctx.emit({ weakRef: typeof WeakRef, registry: typeof FinalizationRegistry, buffer: typeof ArrayBuffer });
  },`);
  assert.equal(sandbox.call('action', [0, '{}', 10]).out.steps[0].json, '{"weakRef":"undefined","registry":"undefined","buffer":"undefined"}');
});

test('the result goes out only when it is truthy after a JSON round trip', () => {
  const sandbox = sandboxFor(`onAction(state, action) { if (action.over) state.over = true; },`);
  assert.equal(sandbox.call('action', [0, '{}', 10]).out.resultJson, null);
  assert.equal(sandbox.call('action', [0, '{"over":true}', 20]).out.resultJson, '{"ranking":["p-a","p-b"]}');
});

test('rejections and errors are frames too, with their logs', () => {
  const sandbox = sandboxFor(`onAction(state, action, ctx) {
    ctx.log('before');
    if (action.bad) { const e = new Error('rejected: nope'); e.__bbReject = true; e.reason = 'nope'; throw e; }
    throw new Error('boom');
  },`);
  const rejected = sandbox.call('action', [0, '{"bad":true}', 10]).out;
  assert.equal(rejected.rejected, 'nope');
  assert.deepEqual(rejected.logs, ['before']);
  assert.throws(() => sandbox.call('action', [0, '{}', 20]), /threw: boom/);
});
