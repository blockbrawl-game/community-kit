export function createModel() {
  const m = { score: 0, over: false };
  function apply(step) {
    if (step.t === 'state') { m.score = step.score; m.over = step.over; }
    else if (step.t === 'score') m.score = step.score;
    else if (step.t === 'over') m.over = true;
  }
  return {
    state: m,
    applySync(steps) { for (const step of steps) apply(step); },
    applySteps(batch) { for (const step of batch.steps) apply(step); },
    snapshot() { return { ...m }; },
  };
}
