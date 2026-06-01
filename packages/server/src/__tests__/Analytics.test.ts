/**
 * Tests for the Analytics module.
 * Verifies that analytics events are emitted to console.log
 * as structured JSON with the correct shape.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { emitAnalytics } from '../services/Analytics.js';

describe('emitAnalytics', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('emits room_created event with correct shape', () => {
    const timestamp = new Date().toISOString();
    emitAnalytics({ type: 'room_created', roomCode: 'ABC123', timestamp });

    expect(consoleSpy).toHaveBeenCalledOnce();
    const [prefix, json] = consoleSpy.mock.calls[0] as [string, string];
    expect(prefix).toBe('[analytics]');
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.type).toBe('room_created');
    expect(parsed.roomCode).toBe('ABC123');
    expect(parsed.timestamp).toBe(timestamp);
  });

  it('emits player_joined event with playerCount', () => {
    const timestamp = new Date().toISOString();
    emitAnalytics({ type: 'player_joined', roomCode: 'ABC123', playerCount: 3, timestamp });

    const [, json] = consoleSpy.mock.calls[0] as [string, string];
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.type).toBe('player_joined');
    expect(parsed.playerCount).toBe(3);
  });

  it('emits game_started event with scenarioId and playerCount', () => {
    const timestamp = new Date().toISOString();
    emitAnalytics({
      type: 'game_started',
      roomCode: 'XYZ789',
      scenarioId: 'nuclear-war',
      playerCount: 7,
      timestamp,
    });

    const [, json] = consoleSpy.mock.calls[0] as [string, string];
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.type).toBe('game_started');
    expect(parsed.scenarioId).toBe('nuclear-war');
    expect(parsed.playerCount).toBe(7);
  });

  it('emits game_completed event with reason and survivorCount', () => {
    const timestamp = new Date().toISOString();
    emitAnalytics({
      type: 'game_completed',
      roomCode: 'XYZ789',
      reason: 'COMPLETED',
      survivorCount: 5,
      timestamp,
    });

    const [, json] = consoleSpy.mock.calls[0] as [string, string];
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.type).toBe('game_completed');
    expect(parsed.reason).toBe('COMPLETED');
    expect(parsed.survivorCount).toBe(5);
  });

  it('does not include PII — no nicknames or player IDs in any event', () => {
    const timestamp = new Date().toISOString();
    emitAnalytics({ type: 'room_created', roomCode: 'ABC123', timestamp });

    const [, json] = consoleSpy.mock.calls[0] as [string, string];
    expect(json).not.toContain('nickname');
    expect(json).not.toContain('playerId');
  });
});
