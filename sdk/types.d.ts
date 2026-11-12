// The interfaces every community mode must implement.

/** Any JSON-serializable value. State, actions and steps must all be plain JSON. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A step is one fact the client needs to know. Keep them small: they are the bandwidth. */
export type Step = { [key: string]: Json };

export interface Player {
  readonly id: string;
  readonly name: string;
  readonly isBot: boolean;
}

export interface Rng {
  /** Float in [0, 1). Math.random() is the same generator. */
  next(): number;
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  pick<T>(array: readonly T[]): T;
  /** Shuffles in place and returns the same array. */
  shuffle<T>(array: T[]): T[];
}

export interface Context {
  readonly players: readonly Player[];
  /** The acting player for onAction and onPlayerStatus, otherwise null. */
  readonly playerId: string | null;
  readonly rng: Rng;
  /** Match clock in milliseconds since the match started. */
  readonly timeMs: number;
  /** Sends a step to every player, or only to one player with `{ to: playerId }`. */
  emit(step: Step, options?: { to?: string }): void;
  log(...args: unknown[]): void;
}

export type PlayerStatus = 'disconnected' | 'reconnected' | 'forfeited';

export interface MatchResult {
  /** Player ids from first place to last. Ties are allowed by nesting: [["a","b"],"c"]. */
  ranking: (string | string[])[];
  scores?: { [playerId: string]: number };
}

/**
 * Server side of a mode. Pure functions over `state`, which must be plain JSON and is owned by
 * the platform (it is snapshotted and restored). Never keep match data in module-level variables.
 */
export interface ModeServer<S = any, A = any> {
  /** Returns the initial state. May emit opening steps. */
  setup(ctx: Context): S;
  /** Validate first, then mutate `state` and emit steps. Throw `reject(reason)` if illegal. */
  onAction(state: S, action: A, ctx: Context): void;
  /** Called `tickRate` times per second when mode.json sets tickRate > 0. */
  onTick?(state: S, dtMs: number, ctx: Context): void;
  onPlayerStatus?(state: S, playerId: string, status: PlayerStatus, ctx: Context): void;
  /**
   * Returns the steps that rebuild everything `playerId` is allowed to see, from nothing.
   * Used when a player joins or reconnects, and whenever a step batch was lost.
   * Must be read-only.
   */
  sync(state: S, playerId: string): Step[];
  /** null while the match is running, the result once it is over. */
  result(state: S): MatchResult | null;
}

export interface SyncInfo {
  modeId: string;
  version: string;
  /** This client's player id. */
  you: string;
  players: Player[];
}

export interface StepBatch {
  kind: 'steps';
  /** Per-player sequence number. The shell guarantees batches arrive in order with no gaps. */
  seq: number;
  timeMs: number;
  steps: Step[];
  /** Set on the batch that resulted from this client's own action. */
  ackActionId?: string;
}

/**
 * Client model: the mode's view of the match, with no DOM access so it can run headless in tests.
 * Export a `createModel()` factory from the file named by `clientModel` in mode.json.
 */
export interface ModeClientModel {
  /** Discard everything and rebuild from sync steps. */
  applySync(steps: Step[], info: SyncInfo): void;
  applySteps(batch: StepBatch): void;
  /** Optional: undo a predicted action that the server refused. */
  onRejected?(actionId: string, reason: string): void;
  /**
   * The authoritative model as plain JSON, without local predictions. The dev kit compares a
   * client that saw every step with one that joined through sync; the two must be equal.
   */
  snapshot(): Json;
}

export interface ModeClientOptions {
  model: ModeClientModel;
  /** Called after the model changed, to re-render. */
  onChange?(batch: StepBatch | { kind: 'sync'; steps: Step[] }): void;
  onRejected?(actionId: string, reason: string): void;
  onResult?(result: MatchResult): void;
}

export interface GameHandle {
  readonly me: string | null;
  readonly players: Player[];
  readonly ready: boolean;
  send(action: Json): string;
  timeMs(): number;
  exit(): void;
}

export function defineMode<S, A>(mode: ModeServer<S, A>): ModeServer<S, A>;
export function reject(reason: string): Error;
export function connect(options: ModeClientOptions): GameHandle;

/** Dev-only action generator used by `devkit test`. Export `nextAction` from the `fuzz` file in mode.json. */
export type NextAction = (model: ModeClientModel, playerId: string, rng: Rng) => Json | null;
