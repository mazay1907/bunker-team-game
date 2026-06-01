/**
 * CharacterDealer — pure function service that deals character cards to players.
 *
 * Algorithm:
 * 1. For each TraitCategory, take a copy of the trait array and Fisher-Yates shuffle it
 * 2. Assign shuffled[0] to player[0], shuffled[1] to player[1], etc.
 * 3. This guarantees no two players share the same trait value in any single category
 *
 * This is a pure data transformation — no IO, no Socket.IO, no Fastify dependencies.
 */

import { randomBytes } from 'crypto';
import type { CharacterCard, TraitSlot, TraitCategory, Trait } from '@bunker/shared';
import { TRAIT_CATEGORIES } from '@bunker/shared';
import type { ContentData } from '../content/ContentData.js';

export class CharacterDealer {
  /**
   * Deals unique character cards to all players.
   * Returns a Map<playerId, CharacterCard>.
   *
   * Throws if playerIds.length > minimum category pool size (prevents dealing
   * more players than there are distinct traits in the smallest category).
   * In practice: each category has 30 entries and max players is 10 — this never throws.
   */
  deal(playerIds: string[], contentData: ContentData): Map<string, CharacterCard> {
    const playerCount = playerIds.length;
    const minPoolSize = contentData.getMinCategorySize();

    if (playerCount > minPoolSize) {
      throw new Error(
        `Cannot deal ${playerCount} cards: smallest trait pool has only ${minPoolSize} entries`,
      );
    }

    // For each category, shuffle and take the first N entries
    const shuffledPerCategory = new Map<TraitCategory, Trait[]>();
    for (const category of TRAIT_CATEGORIES) {
      const traits = [...contentData.getTraitsByCategory(category)];
      fisherYatesShuffle(traits);
      shuffledPerCategory.set(category, traits);
    }

    // Assemble cards — player[i] gets shuffled[category][i] for each category
    const cards = new Map<string, CharacterCard>();
    for (let i = 0; i < playerIds.length; i++) {
      const playerId = playerIds[i];
      if (!playerId) continue;

      const traits = {} as Record<TraitCategory, TraitSlot>;
      for (const category of TRAIT_CATEGORIES) {
        const categoryTraits = shuffledPerCategory.get(category);
        const trait = categoryTraits?.[i];
        if (!trait) {
          throw new Error(`No trait available for category ${category} at index ${i}`);
        }
        traits[category] = {
          category,
          traitId: trait.id,
          value: trait.value, // denormalized display string
          isRevealed: false, // all traits start hidden
        };
      }

      cards.set(playerId, { playerId, traits });
    }

    return cards;
  }
}

/**
 * Fisher-Yates shuffle — mutates the array in place.
 * Uses crypto.randomBytes for unbiased randomness.
 */
function fisherYatesShuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    // Generate a random index in [0, i]
    const j = randomInt(i + 1);
    // Swap arr[i] and arr[j]
    const temp = arr[i];
    const swapTarget = arr[j];
    if (temp !== undefined && swapTarget !== undefined) {
      arr[i] = swapTarget;
      arr[j] = temp;
    }
  }
}

/**
 * Returns a cryptographically random integer in [0, max).
 * Avoids modulo bias by rejection sampling.
 */
function randomInt(max: number): number {
  if (max <= 1) return 0;
  // Find the largest multiple of max that fits in a byte
  const limit = 256 - (256 % max);
  let value: number;
  do {
    const byte = randomBytes(1)[0];
    if (byte === undefined) throw new Error('randomBytes returned no bytes');
    value = byte;
  } while (value >= limit);
  return value % max;
}
