// The 20 Hz grid every match runs on. The server's MatchClock (Logic/MatchClock.cs in the game) is the same
// arithmetic, so a mode ticks at the same match times here and there.
//
//   - A slot is 50 ms from match time 0. A mode is ticked every `slotsPerTick` slots, so dtMs is a multiple of 50.
//   - Ticks land on multiples of the tick period, so the last tick follows from the match time alone.
//   - A late tick runs once, with every period that passed, up to MAX_LAG_SLOTS; the rest is dropped.
//   - Actions keep exact host milliseconds between ticks; a tick that is due runs first.

export const SLOT_MS = 50;
export const SLOTS_PER_SECOND = 1000 / SLOT_MS;
export const MAX_LAG_SLOTS = 4;

/** Grid slots between ticks for an SDK 0.1 tickRate: max(1, round(20 / rate)), or 0 for a mode without a tick. */
export function slotsPerTick(tickRate) {
  if (!(tickRate > 0)) return 0;
  return Math.max(1, Math.round(SLOTS_PER_SECOND / tickRate));
}

export function periodMs(slots) {
  return slots * SLOT_MS;
}

/** The time of the last tick at or before timeMs. */
export function lastTickMs(timeMs, slots) {
  const period = periodMs(slots);
  return timeMs - (((timeMs % period) + period) % period);
}

/** The time of the next tick after timeMs, or null for a mode without a tick. */
export function nextTickMs(timeMs, slots) {
  return slots > 0 ? lastTickMs(timeMs, slots) + periodMs(slots) : null;
}

/** The tick due at host match time hostMs: { dtMs, atMs, droppedMs }, or null when none is due. */
export function due(timeMs, hostMs, slots) {
  if (!(slots > 0)) return null;
  const period = periodMs(slots);
  const last = lastTickMs(timeMs, slots);
  const periods = Math.floor((hostMs - last) / period);
  if (periods <= 0) return null;
  const cap = Math.max(1, Math.floor(MAX_LAG_SLOTS / slots));
  const dtMs = Math.min(periods, cap) * period;
  return { dtMs, atMs: last + dtMs, droppedMs: periods > cap ? (periods - cap) * period : 0 };
}
