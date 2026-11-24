// Editor types for sdk/offline.js (TypeScript prefers this file; the build never reads it).
import type { Player } from './types';

export interface OfflineGame {
  /** This player's id, once the host has said who is playing. */
  me: string | null;
  players: Player[];
  ready: boolean;
  /** Reports the end of a run. The host shows it; it is not verified, so it earns nothing. */
  finish(result: { score: number }): void;
  /** Asks the host to close the mode. */
  exit(): void;
}

export function connectOffline(options?: { onReady?: (game: OfflineGame) => void }): OfflineGame;
