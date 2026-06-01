/**
 * Unit tests for CharacterDealer.
 * Tests: uniqueness, completeness, isRevealed=false, error cases, randomness.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CharacterDealer } from '../services/CharacterDealer.js';
import type { ContentData } from '../content/ContentData.js';
import type { Trait, TraitCategory } from '@bunker/shared';
import { TRAIT_CATEGORIES } from '@bunker/shared';

// ── Mock ContentData factory ──────────────────────────────────────────────────

function makeTrait(id: string, category: TraitCategory, value: string): Trait {
  return { id, category, value };
}

function makeContentData(traitsPerCategory: number): ContentData {
  const traitMap = new Map<TraitCategory, Trait[]>();
  for (const category of TRAIT_CATEGORIES) {
    const traits: Trait[] = [];
    for (let i = 0; i < traitsPerCategory; i++) {
      traits.push(makeTrait(`${category}-${i}`, category, `${category} value ${i}`));
    }
    traitMap.set(category, traits);
  }

  return {
    getTraitsByCategory: (category: TraitCategory) => traitMap.get(category) ?? [],
    getMinCategorySize: () => traitsPerCategory,
    getScenario: () => undefined,
    getAvailableScenarios: () => [],
    scenarios: [],
  } as unknown as ContentData;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CharacterDealer', () => {
  let dealer: CharacterDealer;
  let contentData: ContentData;

  beforeEach(() => {
    dealer = new CharacterDealer();
    contentData = makeContentData(30);
  });

  it('deals 6 cards with all 7 trait categories', () => {
    const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    const cards = dealer.deal(playerIds, contentData);

    expect(cards.size).toBe(6);

    for (const playerId of playerIds) {
      const card = cards.get(playerId);
      expect(card).toBeDefined();
      expect(card?.playerId).toBe(playerId);

      const traitCategories = Object.keys(card?.traits ?? {}) as TraitCategory[];
      expect(traitCategories).toHaveLength(7);

      for (const category of TRAIT_CATEGORIES) {
        expect(traitCategories).toContain(category);
      }
    }
  });

  it('deals 10 cards (maximum players)', () => {
    const playerIds = Array.from({ length: 10 }, (_, i) => `player-${i}`);
    const cards = dealer.deal(playerIds, contentData);
    expect(cards.size).toBe(10);
  });

  it('sets isRevealed=false for all traits in all cards', () => {
    const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    const cards = dealer.deal(playerIds, contentData);

    for (const card of cards.values()) {
      for (const category of TRAIT_CATEGORIES) {
        const slot = card.traits[category];
        expect(slot).toBeDefined();
        expect(slot?.isRevealed).toBe(false);
      }
    }
  });

  it('no two players share the same trait in the same category', () => {
    const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    const cards = dealer.deal(playerIds, contentData);

    for (const category of TRAIT_CATEGORIES) {
      const traitIds = Array.from(cards.values()).map(
        (card) => card.traits[category]?.traitId,
      );
      const uniqueIds = new Set(traitIds);
      expect(uniqueIds.size).toBe(playerIds.length);
    }
  });

  it('denormalizes the value field from the trait entry', () => {
    const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    const cards = dealer.deal(playerIds, contentData);

    for (const card of cards.values()) {
      for (const category of TRAIT_CATEGORIES) {
        const slot = card.traits[category];
        expect(slot?.value).toMatch(/value \d+$/);
      }
    }
  });

  it('throws when playerIds.length > min category pool size', () => {
    const smallContentData = makeContentData(5); // only 5 traits per category
    const playerIds = Array.from({ length: 6 }, (_, i) => `p${i}`);

    expect(() => dealer.deal(playerIds, smallContentData)).toThrow();
  });

  it('produces different assignments on consecutive deals (randomness check)', () => {
    const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];

    // Run 10 deals and check that not all produce identical results
    const firstCategory = TRAIT_CATEGORIES[0];
    if (!firstCategory) throw new Error('No categories');

    const firstPlayerTraitIds = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const cards = dealer.deal(playerIds, contentData);
      const card = cards.get('p1');
      const traitId = card?.traits[firstCategory]?.traitId;
      if (traitId) firstPlayerTraitIds.add(traitId);
    }

    // After 10 deals, we should see at least 2 different assignments for p1
    // (probability of all 10 being identical is (1/30)^9 ≈ negligible)
    expect(firstPlayerTraitIds.size).toBeGreaterThan(1);
  });
});
