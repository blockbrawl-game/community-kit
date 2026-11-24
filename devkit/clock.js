// The 50 ms grid every match runs on. The server's MatchClock (Logic/MatchClock.cs in the game) is the same
// arithmetic, so a mode is ticked at the same match times here and there.
//
//   - Ticks land on 50 ms slots from match time 0. A mode that is awake is ticked on every slot.
//   - A mode that sleeps until t is ticked on the first slot at or after t; one that sleeps without a time
//     (wake = ASLEEP) is not ticked until an action or a status change wakes it.
//   - A late tick runs once, on the latest slot, so its dtMs carries the time that passed. Lag beyond
//     MAX_LAG_SLOTS is dropped: the match clock falls behind the wall clock instead of jumping.
//   - Actions keep exact host milliseconds between ticks; a tick that is due runs first.

export const SLOT_MS = 50;
export const MAX_LAG_SLOTS = 4;
export const ASLEEP = -1;

const MAX_LAG_MS = MAX_LAG_SLOTS * SLOT_MS;

/** The first slot after timeMs. */
export function slotAfter(timeMs) {
  return Math.floor(timeMs / SLOT_MS) * SLOT_MS + SLOT_MS;
}

/** The next tick for a match at timeMs whose mode asked to wake at `wake`; null when it sleeps until an event. */
export function nextTickMs(timeMs, wake) {
  if (wake === ASLEEP) return null;
  return Math.max(slotAfter(timeMs), Math.ceil(wake / SLOT_MS) * SLOT_MS);
}

/** The tick due at host match time hostMs: { atMs, droppedMs }, or null when none is due. */
export function due(timeMs, hostMs, wake) {
  const next = nextTickMs(timeMs, wake);
  if (next === null || hostMs < next) return null;
  const latest = Math.floor(hostMs / SLOT_MS) * SLOT_MS;
  const droppedMs = Math.max(0, latest - next - MAX_LAG_MS);
  return { atMs: latest - droppedMs, droppedMs };
}
