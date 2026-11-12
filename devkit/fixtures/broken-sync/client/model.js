export function createModel() {
  const m = { a: 0, b: 0, over: false };
  function apply(step) {
    if (step.t === 'state') { m.a = step.a; m.b = step.b ?? 0; m.over = step.over; }
    else if (step.t === 'a') m.a++;
    else if (step.t === 'b') m.b++;
    else if (step.t === 'over') m.over = true;
  }
  return {
    state: m,
    applySync(steps) { for (const step of steps) apply(step); },
    applySteps(batch) { for (const step of batch.steps) apply(step); },
    snapshot() { return { ...m }; },
  };
}
