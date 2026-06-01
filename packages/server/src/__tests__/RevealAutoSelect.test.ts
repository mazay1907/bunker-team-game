/**
 * Unit tests for RevealAutoSelect helpers.
 * Tests: pickRandomUnrevealed — correct count, from unrevealed only, handles edge cases.
 * Tests: getPlayersWhoHaveNotSubmitted — filters by status and submission map.
 */

import { describe, it, expect } from 'vitest';
import { pickRandomUnrevealed, getPlayersWhoHaveNotSubmitted } from '../services/RevealAutoSelect.js';
import type { Player, TraitCategory, TraitSlot, CharacterCard } from '@bunker/shared';
import { TRAIT_CATEGORIES } from '@bunker/shared';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTraitSlot(
  category: TraitCategory,
  isRevealed: boolean,
): TraitSlot {
  return { category, traitId: `${category}-1`, value: `${category} val`, isRevealed };
}

function makeCharacterCard(revealedCategories: TraitCategory[]): CharacterCard {
  const traits = {} as CharacterCard['traits'];
  for (const cat of TRAIT_CATEGORIES) {
    traits[cat] = makeTraitSlot(cat, revealedCategories.includes(cat));
  }
  return { playerId: 'test-player', traits };
}

function makePlayer(
  overrides: Partial<Pick<Player, 'playerId' | 'status' | 'character'>> = {},
): Player {
  // Use explicit key-in check so null character is preserved (not replaced by default)
  const character = 'character' in overrides ? (overrides.character ?? null) : makeCharacterCard([]);
  return {
    playerId: overrides.playerId ?? 'player-1',
    roomId: 'room-1',
    nickname: 'Tester',
    sessionToken: 'tok',
    reconnectToken: 'rtok',
    socketId: null,
    status: overrides.status ?? 'ACTIVE',
    joinedAt: new Date(),
    disconnectedAt: null,
    eliminatedInRound: null,
    character,
    revealHistory: [],
  };
}

// ── pickRandomUnrevealed ───────────────────────────────────────────────────────

describe('pickRandomUnrevealed', () => {
  it('returns exactly `count` categories when enough unrevealed exist', () => {
    const player = makePlayer({ character: makeCharacterCard([]) });
    const result = pickRandomUnrevealed(player, 2);
    expect(result).toHaveLength(2);
  });

  it('returns only categories that are NOT already revealed', () => {
    const alreadyRevealed: TraitCategory[] = ['GENDER_AGE', 'PROFESSION', 'HEALTH'];
    const player = makePlayer({ character: makeCharacterCard(alreadyRevealed) });
    const result = pickRandomUnrevealed(player, 2);

    expect(result).toHaveLength(2);
    for (const cat of result) {
      expect(alreadyRevealed).not.toContain(cat);
    }
  });

  it('returns no duplicates in the selection', () => {
    const player = makePlayer({ character: makeCharacterCard([]) });
    const result = pickRandomUnrevealed(player, 3);
    const unique = new Set(result);
    expect(unique.size).toBe(result.length);
  });

  it('returns fewer than `count` when not enough unrevealed remain', () => {
    // Reveal 6 out of 7, only 1 unrevealed — ask for 2
    const sixRevealed = TRAIT_CATEGORIES.slice(0, 6) as TraitCategory[];
    const player = makePlayer({ character: makeCharacterCard(sixRevealed) });
    const result = pickRandomUnrevealed(player, 2);
    expect(result).toHaveLength(1); // only 1 unrevealed left
  });

  it('returns empty array when all categories are already revealed', () => {
    const player = makePlayer({ character: makeCharacterCard([...TRAIT_CATEGORIES]) });
    const result = pickRandomUnrevealed(player, 2);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when player has no character', () => {
    const player = makePlayer({ character: null });
    const result = pickRandomUnrevealed(player, 2);
    expect(result).toHaveLength(0);
  });

  it('returns a valid single category when count is 1', () => {
    const player = makePlayer({ character: makeCharacterCard([]) });
    const result = pickRandomUnrevealed(player, 1);
    expect(result).toHaveLength(1);
    expect(TRAIT_CATEGORIES).toContain(result[0]);
  });

  it('result is a subset of valid TRAIT_CATEGORIES', () => {
    const player = makePlayer({ character: makeCharacterCard([]) });
    const result = pickRandomUnrevealed(player, 2);
    for (const cat of result) {
      expect(TRAIT_CATEGORIES).toContain(cat);
    }
  });
});

// ── getPlayersWhoHaveNotSubmitted ─────────────────────────────────────────────

describe('getPlayersWhoHaveNotSubmitted', () => {
  it('returns players who are ACTIVE and have not submitted', () => {
    const active = makePlayer({ playerId: 'p1', status: 'ACTIVE' });
    const result = getPlayersWhoHaveNotSubmitted([active], new Set());
    expect(result).toHaveLength(1);
    expect(result[0]?.playerId).toBe('p1');
  });

  it('returns RECONNECTING players who have not submitted', () => {
    const reconnecting = makePlayer({ playerId: 'p2', status: 'RECONNECTING' });
    const result = getPlayersWhoHaveNotSubmitted([reconnecting], new Set());
    expect(result).toHaveLength(1);
  });

  it('excludes players who already submitted', () => {
    const p1 = makePlayer({ playerId: 'p1', status: 'ACTIVE' });
    const p2 = makePlayer({ playerId: 'p2', status: 'ACTIVE' });
    const submitted = new Set(['p1']);
    const result = getPlayersWhoHaveNotSubmitted([p1, p2], submitted);
    expect(result).toHaveLength(1);
    expect(result[0]?.playerId).toBe('p2');
  });

  it('excludes SPECTATOR players even if not submitted', () => {
    const spectator = makePlayer({ playerId: 'sp1', status: 'SPECTATOR' });
    const result = getPlayersWhoHaveNotSubmitted([spectator], new Set());
    expect(result).toHaveLength(0);
  });

  it('excludes KICKED players', () => {
    const kicked = makePlayer({ playerId: 'kp1', status: 'KICKED' });
    const result = getPlayersWhoHaveNotSubmitted([kicked], new Set());
    expect(result).toHaveLength(0);
  });

  it('returns empty array when all players have submitted', () => {
    const p1 = makePlayer({ playerId: 'p1', status: 'ACTIVE' });
    const p2 = makePlayer({ playerId: 'p2', status: 'ACTIVE' });
    const result = getPlayersWhoHaveNotSubmitted([p1, p2], new Set(['p1', 'p2']));
    expect(result).toHaveLength(0);
  });
});
