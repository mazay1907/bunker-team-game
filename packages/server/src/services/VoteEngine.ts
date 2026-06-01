/**
 * VoteEngine — manages vote collection, tally, and tie resolution.
 *
 * Resolution order (per GAME_RULES.md):
 * 1. Player with most votes → eliminated
 * 2. First tie → re-vote between tied players only
 * 3. Re-vote tie → host tiebreaker (or longest-connected player if host eliminated)
 *
 * VoteEngine is stateless per call — all state lives in Round and Room.
 */

import type { Round, Room, VoteRecord } from '@bunker/shared';

export interface TallyResult {
  /** Player IDs tied for most votes (length 1 means clear winner) */
  leaders: string[];
  /** Tally map: targetId → count */
  tally: Record<string, number>;
}

export class VoteEngine {
  /**
   * Tallies votes from a Map<voterId, VoteRecord>.
   * Abstentions (isAbstention=true) do not count toward any target.
   */
  tally(votes: Map<string, VoteRecord>): TallyResult {
    const tally: Record<string, number> = {};
    for (const record of votes.values()) {
      if (record.isAbstention) continue;
      tally[record.targetId] = (tally[record.targetId] ?? 0) + 1;
    }
    return { leaders: this.findLeaders(tally), tally };
  }

  /**
   * Returns the player IDs with the maximum vote count.
   * Empty array if no votes at all.
   */
  findLeaders(tally: Record<string, number>): string[] {
    const entries = Object.entries(tally);
    if (entries.length === 0) return [];

    const maxVotes = Math.max(...entries.map(([, count]) => count));
    return entries
      .filter(([, count]) => count === maxVotes)
      .map(([id]) => id);
  }

  /**
   * Checks if all active players have submitted votes.
   * Active = ACTIVE or RECONNECTING status (not SPECTATOR, not KICKED).
   */
  isVotingComplete(round: Round, room: Room): boolean {
    const activePlayers = [...room.players.values()].filter(
      (p) => p.status === 'ACTIVE' || p.status === 'RECONNECTING',
    );
    // All active players must have a vote record (including abstentions)
    return activePlayers.every(
      (p) => round.votes.has(p.playerId) || round.tiebreakVotes?.has(p.playerId),
    );
  }

  /**
   * Determines the eliminating player from round votes.
   * Returns playerId to eliminate, or null if cannot be resolved
   * (caller should trigger tiebreaker flow).
   */
  resolveElimination(round: Round): string | null {
    const { leaders } = this.tally(round.votes);
    if (leaders.length === 1) return leaders[0] ?? null;

    // Tie — check tiebreak votes
    if (round.tiebreakVotes && round.tiebreakVotes.size > 0) {
      const { leaders: tbLeaders } = this.tally(round.tiebreakVotes);
      if (tbLeaders.length === 1) return tbLeaders[0] ?? null;
    }

    return null; // Still tied — host decides
  }

  /**
   * Determines which player should cast the tiebreaker vote.
   * Per GAME_RULES.md: current host if not eliminated; otherwise
   * the longest-connected (earliest joinedAt) non-eliminated player.
   */
  getTiebreakerDecider(room: Room): string {
    const host = room.players.get(room.hostPlayerId);
    if (host && (host.status === 'ACTIVE' || host.status === 'RECONNECTING')) {
      return room.hostPlayerId;
    }

    // Host is eliminated — find longest-connected non-eliminated player
    const candidates = [...room.players.values()]
      .filter((p) => p.status === 'ACTIVE' || p.status === 'RECONNECTING')
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());

    const decider = candidates[0];
    if (!decider) throw new Error('No eligible tiebreaker decider found');
    return decider.playerId;
  }

  /**
   * Checks if a vote target is valid:
   * - target must exist in room
   * - target must be ACTIVE or RECONNECTING
   * - voter cannot vote for themselves
   */
  isValidVoteTarget(
    voterId: string,
    targetId: string,
    room: Room,
    allowedIds?: string[], // if provided, target must be in this set (for re-vote)
  ): boolean {
    if (voterId === targetId) return false;
    const target = room.players.get(targetId);
    if (!target) return false;
    if (target.status !== 'ACTIVE' && target.status !== 'RECONNECTING') return false;
    if (allowedIds && !allowedIds.includes(targetId)) return false;
    return true;
  }
}
