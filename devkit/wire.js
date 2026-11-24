// The prelude's output format (runtime/prelude.js, v2), decoded. The server's CommunityMatch reads the same format.
//
// A call returns either the empty string (nothing happened: no steps, no logs, no result) or a run of records,
// each `<tag><length>:<payload>`, where the length counts UTF-16 code units of the payload:
//
//   B  a step for everyone: the step's JSON
//   P  a step for one player: `<player index>,<step JSON>`
//   R  the match result's JSON (only when it is truthy)
//   X  the action was rejected: the reason
//   E  the mode threw: the message        K  the stack
//   L  one console line
//
// Lengths are written by the prelude, never by the mode, so nothing a mode returns can break the framing.

const TAGS = new Set(['B', 'P', 'R', 'X', 'E', 'K', 'L']);

/**
 * Decodes one call's output. Returns { steps: [{ to: -1 | playerIndex, json }], resultJson, rejected, error, stack,
 * logs }. Throws on anything the prelude would never produce.
 */
export function decodeFrames(raw) {
  const out = { steps: [], resultJson: null, rejected: null, error: null, stack: null, logs: [] };
  let i = 0;
  while (i < raw.length) {
    const tag = raw[i];
    const colon = raw.indexOf(':', i + 1);
    if (!TAGS.has(tag) || colon < 0) throw new Error(`malformed output at ${i}`);
    const length = Number(raw.slice(i + 1, colon));
    if (!Number.isInteger(length) || length < 0 || colon + 1 + length > raw.length) throw new Error(`malformed output at ${i}`);
    const payload = raw.slice(colon + 1, colon + 1 + length);
    i = colon + 1 + length;

    switch (tag) {
      case 'B':
        out.steps.push({ to: -1, json: payload });
        break;
      case 'P': {
        const comma = payload.indexOf(',');
        const to = Number(payload.slice(0, comma));
        if (comma < 1 || !Number.isInteger(to) || to < 0) throw new Error('malformed private step');
        out.steps.push({ to, json: payload.slice(comma + 1) });
        break;
      }
      case 'R': out.resultJson = payload; break;
      case 'X': out.rejected = payload; break;
      case 'E': out.error = payload; break;
      case 'K': out.stack = payload; break;
      case 'L': out.logs.push(payload); break;
    }
  }
  return out;
}

/**
 * The length of `JSON.stringify(steps)` for the prelude's previous output shape, `[{ to: id | null, step }]`. The
 * bench charges a mode for the bytes it emits, and that measure must not change with the wire format.
 */
export function legacyStepsJsonLength(steps, playerIds) {
  if (steps.length === 0) return 2;
  let length = 2 + (steps.length - 1);
  for (const { to, json } of steps) {
    const toLength = to < 0 ? 4 : JSON.stringify(playerIds[to]).length;
    length += 6 + toLength + 8 + json.length + 1; // {"to": <to> ,"step": <json> }
  }
  return length;
}
