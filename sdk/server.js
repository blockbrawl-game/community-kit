// Server-side SDK for community modes. This file is bundled into the mode's server script.

const REQUIRED = ['setup', 'onAction', 'sync', 'result'];
const OPTIONAL = ['onTick', 'onPlayerStatus'];

/**
 * Declares a mode. Validates the shape early so mistakes fail at load time, not mid-match.
 * @param {import('./types').ModeServer} mode
 */
export function defineMode(mode) {
  for (const name of REQUIRED) {
    if (typeof mode[name] !== 'function') {
      throw new Error(`defineMode: missing required function "${name}".`);
    }
  }
  for (const name of Object.keys(mode)) {
    if (!REQUIRED.includes(name) && !OPTIONAL.includes(name)) {
      throw new Error(`defineMode: unknown member "${name}". Allowed: ${[...REQUIRED, ...OPTIONAL].join(', ')}.`);
    }
  }
  return Object.freeze({ ...mode });
}

/**
 * Throw this from onAction to refuse an illegal action. Validate before mutating state:
 * a rejected action must leave the state exactly as it was.
 * @param {string} reason short machine-readable reason, sent back to the acting player only
 */
export function reject(reason) {
  const error = new Error(`rejected: ${reason}`);
  error.__bbReject = true;
  error.reason = reason;
  return error;
}
