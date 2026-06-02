/**
 * Unit tests for VoteEngine.
 */

import { describe, it, expect } from 'vitest';
import { VoteEngine } from '../services/VoteEngine.js';
import type { Room, Player, Round, VoteRecord } from '@bunker/shared';

function makeVoteRecord(voterId: string, targetId: string): VoteRecord {
  return { voterId, targetId, submittedAt: new Date(), isAbstention: false };
}

function makeAbstention(voterId: string): VoteRecord {
  return { voterId, targetId: '', submittedAt: new Date(), isAbstention: true };
}

function makePlayer(id: string, status: Player['status'] = 'ACTIVE'): Player {
  return {
    playerId: id,
    roomId: 'room1',
    nickname: id,
    sessionToken: id,
    reconnectToken: id,
    socketId: null,
    status,
    joinedAt: new Date(),
    disconnectedAt: null,
    eliminatedInRound: null,
    character: null,
    revealHistory: [],
  };
}

function makeRoom(players: Player[]): Room {
  const map = new Map(players.map((p) => [p.playerId, p]));
  return {
    roomId: 'room1',
    roomCode: 'TEST01',
    hostPlayerId: players[0]!.playerId,
    state: 'R1_VOTE',
    currentRound: 1,
    currentPhase: 'VOTE',
    scenarioId: null,
    players: map,
    game: null,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    hostUserId: null,
  };
}

describe('VoteEngine', () => {
  const engine = new VoteEngine();

  describe('tally', () => {
    it('counts votes correctly', () => {
      const votes = new Map([
        ['v1', makeVoteRecord('v1', 'p1')],
        ['v2', makeVoteRecord('v2', 'p1')],
        ['v3', makeVoteRecord('v3', 'p2')],
      ]);
      const { tally, leaders } = engine.tally(votes);
      expect(tally['p1']).toBe(2);
      expect(tally['p2']).toBe(1);
      expect(leaders).toEqual(['p1']);
    });

    it('detects tie correctly', () => {
      const votes = new Map([
        ['v1', makeVoteRecord('v1', 'p1')],
        ['v2', makeVoteRecord('v2', 'p2')],
        ['v3', makeVoteRecord('v3', 'p1')],
        ['v4', makeVoteRecord('v4', 'p2')],
      ]);
      const { leaders } = engine.tally(votes);
      expect(leaders).toHaveLength(2);
      expect(leaders).toContain('p1');
      expect(leaders).toContain('p2');
    });

    it('ignores abstentions', () => {
      const votes = new Map([
        ['v1', makeVoteRecord('v1', 'p1')],
        ['v2', makeAbstention('v2')],
      ]);
      const { tally, leaders } = engine.tally(votes);
      expect(tally['p1']).toBe(1);
      expect(leaders).toEqual(['p1']);
    });

    it('returns empty leaders for no votes', () => {
      const { leaders } = engine.tally(new Map());
      expect(leaders).toHaveLength(0);
    });
  });

  describe('isValidVoteTarget', () => {
    it('rejects self-vote', () => {
      const room = makeRoom([makePlayer('p1'), makePlayer('p2')]);
      expect(engine.isValidVoteTarget('p1', 'p1', room)).toBe(false);
    });

    it('rejects vote for non-existent player', () => {
      const room = makeRoom([makePlayer('p1'), makePlayer('p2')]);
      expect(engine.isValidVoteTarget('p1', 'p999', room)).toBe(false);
    });

    it('rejects vote for spectator', () => {
      const room = makeRoom([makePlayer('p1'), makePlayer('p2', 'SPECTATOR')]);
      expect(engine.isValidVoteTarget('p1', 'p2', room)).toBe(false);
    });

    it('accepts valid vote for active player', () => {
      const room = makeRoom([makePlayer('p1'), makePlayer('p2')]);
      expect(engine.isValidVoteTarget('p1', 'p2', room)).toBe(true);
    });

    it('restricts to allowedIds in tiebreak', () => {
      const room = makeRoom([makePlayer('p1'), makePlayer('p2'), makePlayer('p3')]);
      // p2 and p3 are tied; p1 cannot vote for p3 if allowedIds=[p2]
      expect(engine.isValidVoteTarget('p1', 'p3', room, ['p2'])).toBe(false);
      expect(engine.isValidVoteTarget('p1', 'p2', room, ['p2'])).toBe(true);
    });
  });

  describe('getTiebreakerDecider', () => {
    it('returns host if host is active', () => {
      const host = makePlayer('host');
      const room = makeRoom([host, makePlayer('p2')]);
      expect(engine.getTiebreakerDecider(room)).toBe('host');
    });

    it('returns longest-connected player if host is eliminated', () => {
      const host = makePlayer('host', 'SPECTATOR');
      const early = { ...makePlayer('early'), joinedAt: new Date(1000) };
      const late = { ...makePlayer('late'), joinedAt: new Date(2000) };
      const room = makeRoom([host, early, late]);
      room.hostPlayerId = 'host';
      expect(engine.getTiebreakerDecider(room)).toBe('early');
    });
  });

  describe('resolveElimination', () => {
    it('returns clear winner', () => {
      const round: Round = {
        roundNumber: 1,
        revealQuota: 2,
        revealSubmissions: new Map(),
        votes: new Map([
          ['v1', makeVoteRecord('v1', 'p2')],
          ['v2', makeVoteRecord('v2', 'p2')],
          ['v3', makeVoteRecord('v3', 'p1')],
        ]),
        tiebreakVotes: null,
        voteChangesUsed: new Set(),
        eliminatedPlayerId: null,
        autoEliminationTriggered: false,
      };
      expect(engine.resolveElimination(round)).toBe('p2');
    });

    it('returns null on unresolved tie', () => {
      const round: Round = {
        roundNumber: 1,
        revealQuota: 2,
        revealSubmissions: new Map(),
        votes: new Map([
          ['v1', makeVoteRecord('v1', 'p1')],
          ['v2', makeVoteRecord('v2', 'p2')],
        ]),
        tiebreakVotes: null,
        voteChangesUsed: new Set(),
        eliminatedPlayerId: null,
        autoEliminationTriggered: false,
      };
      expect(engine.resolveElimination(round)).toBeNull();
    });
  });
});
