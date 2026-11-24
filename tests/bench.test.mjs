// The bench as a gate: an over-budget mode fails, and the numbers repeat exactly. Run with `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runBench } from '../devkit/bench.js';

async function quietBench(modeName) {
  const log = console.log;
  console.log = () => {};
  try {
    const report = {};
    const passed = await runBench({ modeName, runs: 4, report });
    return { passed, report };
  } finally {
    console.log = log;
  }
}

test('a mode that is correct but too expensive is over budget', async () => {
  // devkit/fixtures/broken-heavy rescans a 150 x 150 grid on every action.
  const { passed, report } = await quietBench('broken-heavy');
  assert.equal(passed, false);
  assert.ok(report.unitsPerSecond > report.gates.maxWorkPerSecond, `units per second ${report.unitsPerSecond}`);
  assert.ok(report.maxCallUnits <= report.gates.maxWorkPerCall, 'only the sustained gate fails');
  assert.equal(report.failures.length, 1);
});

test('two runs of the bench give identical numbers', async () => {
  const a = await quietBench('broken-heavy');
  const b = await quietBench('broken-heavy');
  assert.deepEqual(a.report.calls, b.report.calls);
  assert.equal(a.report.unitsPerSecond, b.report.unitsPerSecond);
});
