/**
 * RevealAutoSelect — auto-selects reveal categories for players who didn't
 * submit before the reveal timeout.
 *
 * WHY this lives in a separate file: the pure selection logic is unit-tested
 * independently without needing Socket.IO or store infrastructure.
 */

import type { TraitCategory, Player } from '@bunker/shared';
import { TRAIT_CATEGORIES } from '@bunker/shared';

/**
 * Returns a random subset of `count` unrevealed categories for the given player.
 * Uses Fisher-Yates partial shuffle to avoid bias.
 *
 * @returns selected categories, or fewer if the player has fewer unrevealed than `count`
 */
export function pickRandomUnrevealed(
  player: Player,
  count: number,
): TraitCategory[] {
  if (!player.character) return [];

  const unrevealed = TRAIT_CATEGORIES.filter(
    (cat) => !player.character!.traits[cat]?.isRevealed,
  );

  // Pick min(count, unrevealed.length) without replacement
  const pickCount = Math.min(count, unrevealed.length);
  if (pickCount === 0) return [];

  // Partial Fisher-Yates: shuffle only the needed portion
  const pool = [...unrevealed];
  for (let i = 0; i < pickCount; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    const temp = pool[i];
    pool[i] = pool[j]!;
    pool[j] = temp!;
  }

  return pool.slice(0, pickCount);
}

/**
 * Collects all players who have not submitted for the given round.
 */
export function getPlayersWhoHaveNotSubmitted(
  players: Player[],
  submittedPlayerIds: Set<string>,
): Player[] {
  return players.filter(
    (p) =>
      (p.status === 'ACTIVE' || p.status === 'RECONNECTING') &&
      !submittedPlayerIds.has(p.playerId),
  );
}
