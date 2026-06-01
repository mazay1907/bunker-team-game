/**
 * Tests for the OutcomeSummary template generator.
 * BACKLOG 8.1.2 — template-based, no AI.
 */

import { describe, it, expect } from 'vitest';
import { buildOutcomeSummary } from '../services/OutcomeSummary.js';
import type { Player } from '@bunker/shared';

function makePlayer(nickname: string, profession?: string): Player {
  return {
    playerId: `p-${nickname}`,
    roomId: 'room-1',
    nickname,
    sessionToken: 'tok',
    reconnectToken: 'rtok',
    socketId: 'socket',
    status: 'ACTIVE',
    joinedAt: new Date(),
    disconnectedAt: null,
    eliminatedInRound: null,
    character: profession
      ? {
          playerId: `p-${nickname}`,
          traits: {
            GENDER_AGE: { category: 'GENDER_AGE', traitId: 'ga-1', value: 'Чоловік 30 р.', isRevealed: true },
            PROFESSION: { category: 'PROFESSION', traitId: 'prof-1', value: profession, isRevealed: true },
            HEALTH: { category: 'HEALTH', traitId: 'h-1', value: 'Здоровий', isRevealed: false },
            HOBBY: { category: 'HOBBY', traitId: 'hob-1', value: 'Плавання', isRevealed: false },
            PHOBIA: { category: 'PHOBIA', traitId: 'ph-1', value: 'Темнота', isRevealed: false },
            BAGGAGE: { category: 'BAGGAGE', traitId: 'bg-1', value: 'Аптечка', isRevealed: false },
            SECRET_FACT: { category: 'SECRET_FACT', traitId: 'sf-1', value: 'Знає мови', isRevealed: false },
          },
        }
      : null,
    revealHistory: [],
  };
}

describe('buildOutcomeSummary', () => {
  it('returns early-end text for HOST_ENDED_EARLY', () => {
    const result = buildOutcomeSummary([], [], 'HOST_ENDED_EARLY');
    expect(result).toBe('Гру завершено достроково.');
  });

  it('returns no-survivor text when survivors array is empty', () => {
    const result = buildOutcomeSummary([], [], 'COMPLETED');
    expect(result).toContain('Ніхто не потрапив');
  });

  it('includes survivor names in completed game summary', () => {
    const survivors = [makePlayer('Аня'), makePlayer('Дмитро')];
    const result = buildOutcomeSummary(survivors, [], 'COMPLETED');
    expect(result).toContain('Аня');
    expect(result).toContain('Дмитро');
  });

  it('includes profession in parentheses when available', () => {
    const survivors = [makePlayer('Аня', 'Лікар'), makePlayer('Дмитро', 'Інженер')];
    const result = buildOutcomeSummary(survivors, [], 'COMPLETED');
    expect(result).toContain('Аня (Лікар)');
    expect(result).toContain('Дмитро (Інженер)');
  });

  it('includes eliminated player names', () => {
    const survivors = [makePlayer('Аня')];
    const eliminated = [makePlayer('Виключений')];
    const result = buildOutcomeSummary(survivors, eliminated, 'COMPLETED');
    expect(result).toContain('Виключений');
  });

  it('uses correct plural for 1 person', () => {
    const result = buildOutcomeSummary([makePlayer('Один')], [], 'COMPLETED');
    expect(result).toContain('1 людина');
  });

  it('uses correct plural for 3 people', () => {
    const survivors = [makePlayer('P1'), makePlayer('P2'), makePlayer('P3')];
    const result = buildOutcomeSummary(survivors, [], 'COMPLETED');
    expect(result).toContain('3 людини');
  });

  it('uses correct plural for 7 people', () => {
    const survivors = Array.from({ length: 7 }, (_, i) => makePlayer(`P${i + 1}`));
    const result = buildOutcomeSummary(survivors, [], 'COMPLETED');
    expect(result).toContain('7 людей');
  });
});
