// The outbox (devkit/outbox.js). The cases match the server's MatchOutboxTests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Outbox, shouldWait } from '../devkit/outbox.js';

function outbox(maxBatchBytes = 16384) {
  const seq = [0, 0];
  const sent = [];
  const box = new Outbox(2, maxBatchBytes, (p) => ++seq[p], (p, message) => sent.push([p, JSON.stringify(message)]));
  return { box, sent };
}

test('the actor gets its pending steps, the action\'s and the ack at once; others wait', () => {
  const { box, sent } = outbox();
  box.steps(0, ['1'], 100);
  box.steps(1, ['1'], 100);
  box.steps(0, ['2'], 120, 'a1');
  box.steps(1, ['2'], 120);
  assert.deepEqual(sent, [[0, '{"kind":"steps","seq":1,"timeMs":120,"steps":[1,2],"ackActionId":"a1"}']]);
  box.flush();
  assert.deepEqual(sent[1], [1, '{"kind":"steps","seq":1,"timeMs":120,"steps":[1,2]}']);
  assert.equal(box.hasPending, false);
});

test('a rejection flushes that player first; a sync replaces their pending steps', () => {
  const { box, sent } = outbox();
  box.steps(0, ['1'], 100);
  box.steps(1, ['1'], 100);
  box.message(0, { kind: 'rejected', actionId: 'a1', reason: 'no' });
  box.sync(1, { kind: 'sync', seq: 0 });
  box.flush();
  assert.deepEqual(sent.map(([p, text]) => `${p} ${text}`), [
    '0 {"kind":"steps","seq":1,"timeMs":100,"steps":[1]}',
    '0 {"kind":"rejected","actionId":"a1","reason":"no"}',
    '1 {"kind":"sync","seq":0}',
  ]);
});

test('merged steps stay within the batch limit', () => {
  const { box, sent } = outbox(200); // room for 72 characters of steps
  const thirty = JSON.stringify('x'.repeat(26)); // 28 characters
  box.steps(0, [thirty], 1);
  box.steps(0, [thirty], 2);
  assert.equal(sent.length, 0);
  box.steps(0, [thirty], 3);
  assert.equal(sent.length, 1);
  box.flush();
  assert.deepEqual(sent.map(([, text]) => JSON.parse(text).steps.length), [2, 1]);
});

test('pending steps wait only for a tick within the next slot', () => {
  assert.equal(shouldWait(100, 150), true);
  assert.equal(shouldWait(100, 151), false);
  assert.equal(shouldWait(100, null), false);
});
