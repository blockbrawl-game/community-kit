// The 50 ms grid (devkit/clock.js). The cases match the server's MatchClockTests, so both hosts tick alike.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ASLEEP, due, nextTickMs } from '../devkit/clock.js';
import { MatchHost } from '../devkit/match.js';

test('an awake mode is due on every slot, never early, and a late tick runs once on the latest slot', () => {
  assert.equal(due(100, 149, 0), null);
  assert.deepEqual(due(100, 150, 0), { atMs: 150, droppedMs: 0 });
  assert.deepEqual(due(100, 199, 0), { atMs: 150, droppedMs: 0 });
  assert.deepEqual(due(100, 260, 0), { atMs: 250, droppedMs: 0 });
  // An action moved the clock between slots: the next slot is still the next one on the grid.
  assert.deepEqual(due(130, 150, 0), { atMs: 150, droppedMs: 0 });
});

test('a sleeping mode is due on the first slot at or after its wake time, or not at all', () => {
  assert.equal(nextTickMs(100, 1000), 1000);
  assert.equal(nextTickMs(100, 1010), 1050);
  assert.equal(nextTickMs(100, 20), 150);
  assert.equal(nextTickMs(100, ASLEEP), null);
  assert.equal(due(100, 999, 1000), null);
  assert.equal(due(100, 99999, ASLEEP), null);
});

test('lag beyond four slots is dropped', () => {
  // Due at 50, fired at 550: the tick runs at 250 (four slots of lag), and 300 ms are given up.
  assert.deepEqual(due(0, 550, 0), { atMs: 250, droppedMs: 300 });
  assert.deepEqual(due(0, 1240, 1000), { atMs: 1200, droppedMs: 0 });
  assert.deepEqual(due(0, 1500, 1000), { atMs: 1200, droppedMs: 300 });
});

test('MatchHost runs a due tick before the action, the action keeps its time, and sleep skips ticks', () => {
  const bundle = `var __bbMode = { default: {
    setup() { return {}; },
    onAction(state, action, ctx) { ctx.emit({ t: 'act', at: ctx.timeMs }); if (action.nap) ctx.sleepUntil(action.nap); },
    onTick(state, dtMs, ctx) { ctx.emit({ t: 'tick', dt: dtMs, at: ctx.timeMs }); },
    sync() { return []; },
    result() { return null; },
  } };`;
  const seen = [];
  const players = [{ id: 'p-a', name: 'A', isBot: false }];
  const host = new MatchHost({
    manifest: { id: 'clock-test', version: '1.0.0' }, bundle, players, seed: 1,
    onSend: (id, message) => { if (message.kind === 'steps') seen.push(...message.steps); },
  });
  host.start();

  assert.equal(host.advanceTo(60), 0);
  host.action('p-a', 'a1', { nap: 400 }, 60);
  assert.equal(host.msToNextTick(70), 330);
  assert.equal(host.advanceTo(399), 0); // asleep until 400: nothing
  host.advanceTo(420);
  assert.deepEqual(seen, [{ t: 'tick', dt: 50, at: 50 }, { t: 'act', at: 60 }, { t: 'tick', dt: 350, at: 400 }]);
  assert.equal(host.msToNextTick(420), 30);

  // The journal replays the tick at its place on the grid.
  assert.deepEqual(host.inputs.filter((i) => i.op === 'tick').map((i) => i.timeMs), [50, 400]);
  assert.equal(host.advanceTo(2000), 1350); // the tick at 450 was due: one tick at 650, the rest dropped
});

test('the sleeping examples still wake for their turn deadlines when nobody acts', async () => {
  const { loadMode, bundleServer } = await import('../devkit/build.js');
  const { devPlayers } = await import('../devkit/match.js');
  for (const [id, timeoutMs] of [['duel-lite', 30000], ['bloom-blocks', 20000]]) {
    const mode = await loadMode(id);
    const steps = [];
    const host = new MatchHost({
      manifest: mode.manifest, bundle: await bundleServer(mode), players: devPlayers(2), seed: 3,
      onSend: (playerId, message) => { if (message.kind === 'steps' && playerId === host.players[0].id) steps.push(...message.steps); },
    });
    host.start();
    // Two minutes of nobody playing, slot by slot, as the server's timer would fire.
    for (let t = 50; t <= 120000; t += 50) host.advanceTo(t);
    const ticks = host.inputs.filter((i) => i.op === 'tick').map((i) => i.timeMs);
    assert.ok(steps.some((s) => s.t === 'timeout'), `${id}: a turn timed out`);
    assert.equal(ticks[0], timeoutMs, `${id}: first tick at the first deadline`);
    assert.ok(ticks.length <= 120000 / timeoutMs + 1, `${id}: ticked only at deadlines (${ticks.length} ticks)`);
  }
});
