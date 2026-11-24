// The 50 ms grid (devkit/clock.js). The cases match the server's MatchClockTests, so both hosts tick alike.
import test from 'node:test';
import assert from 'node:assert/strict';
import { slotsPerTick, due, nextTickMs, lastTickMs } from '../devkit/clock.js';
import { MatchHost } from '../devkit/match.js';

test('SDK 0.1 rates map to whole grid slots', () => {
  const cases = [[0, 0], [1, 20], [2, 10], [3, 7], [8, 3], [10, 2], [14, 1], [20, 1], [30, 1]];
  for (const [rate, slots] of cases) assert.equal(slotsPerTick(rate), slots, `tickRate ${rate}`);
});

test('a tick is due once per period, never early, with every whole period when late', () => {
  assert.equal(due(100, 149, 1), null);
  assert.deepEqual(due(100, 150, 1), { dtMs: 50, atMs: 150, droppedMs: 0 });
  assert.deepEqual(due(100, 199, 1), { dtMs: 50, atMs: 150, droppedMs: 0 });
  assert.deepEqual(due(100, 260, 1), { dtMs: 150, atMs: 250, droppedMs: 0 });
  assert.deepEqual(due(230, 300, 2), { dtMs: 100, atMs: 300, droppedMs: 0 });
});

test('the lag is capped at four slots and the rest dropped', () => {
  assert.deepEqual(due(0, 550, 1), { dtMs: 200, atMs: 200, droppedMs: 350 });
  assert.deepEqual(due(0, 400, 2), { dtMs: 200, atMs: 200, droppedMs: 200 });
  assert.deepEqual(due(0, 1500, 10), { dtMs: 500, atMs: 500, droppedMs: 1000 });
});

test('the next tick follows from the match time alone', () => {
  assert.equal(lastTickMs(130, 1), 100);
  assert.equal(nextTickMs(130, 1), 150);
  assert.equal(nextTickMs(500, 10), 1000);
  assert.equal(nextTickMs(500, 0), null);
});

test('MatchHost runs a due tick before the action, and the action keeps its exact time', () => {
  const bundle = `var __bbMode = { default: {
    setup() { return {}; },
    onAction(state, action, ctx) { ctx.emit({ t: 'act', at: ctx.timeMs }); },
    onTick(state, dtMs, ctx) { ctx.emit({ t: 'tick', dt: dtMs, at: ctx.timeMs }); },
    sync() { return []; },
    result() { return null; },
  } };`;
  const seen = [];
  const players = [{ id: 'p-a', name: 'A', isBot: false }];
  const host = new MatchHost({
    manifest: { id: 'clock-test', version: '1.0.0', tickRate: 10 }, bundle, players, seed: 1,
    onSend: (id, message) => { if (message.kind === 'steps') seen.push(...message.steps); },
  });
  host.start();

  assert.equal(host.advanceTo(130), 0);
  host.action('p-a', 'a1', {}, 130);
  assert.equal(host.msToNextTick(130), 70);
  host.advanceTo(170);
  host.action('p-a', 'a2', {}, 170);
  assert.equal(host.advanceTo(260), 0);
  assert.deepEqual(seen, [
    { t: 'tick', dt: 100, at: 100 }, { t: 'act', at: 130 }, { t: 'act', at: 170 }, { t: 'tick', dt: 100, at: 200 },
  ]);
  assert.equal(host.msToNextTick(260), 40);

  // The journal replays the tick at its place on the grid, not at timeMs + dtMs.
  assert.deepEqual(host.inputs.filter((i) => i.op === 'tick').map((i) => i.timeMs), [100, 200]);
  assert.equal(host.advanceTo(2000), 1600); // 18 periods since the tick at 200: one 200 ms tick, 1600 ms dropped
});
