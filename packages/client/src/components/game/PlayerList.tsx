/**
 * PlayerList — shows all players with their visible traits and status.
 * Used in all game phases.
 */

import { Crown, X } from 'lucide-react';
import type { PlayerView, TraitCategory } from '@bunker/shared';
import { t } from '../../i18n/t.js';

const TRAIT_EMOJI: Record<TraitCategory, string> = {
  GENDER_AGE: '👤',
  PROFESSION: '💼',
  HEALTH: '❤️',
  HOBBY: '🎯',
  PHOBIA: '😱',
  BAGGAGE: '🎒',
  SECRET_FACT: '🔍',
};

interface PlayerListProps {
  players: PlayerView[];
  ownPlayerId: string | null;
  /** In vote phase, votes keyed by targetId */
  voteTargetIds?: string[];
  voteTally?: Record<string, number>;
  /** Show vote tallies only after all players have voted */
  showVoteTally?: boolean;
  /** If provided, a vote-button is rendered per player */
  onVote?: (targetId: string) => void;
  hasVoted?: boolean;
  /** In tiebreak, only these player IDs are voteable */
  allowedVoteIds?: string[];
  /** Host-only: kick a player from the game */
  onKick?: (targetId: string) => void;
  isHost?: boolean;
  /** Player ID of the current debate speaker (highlights their row) */
  currentSpeakerId?: string | null;
  /** Players who submitted in REVEAL phase but whose traits are still hidden */
  revealSubmittedIds?: string[];
}

export function PlayerList({
  players,
  ownPlayerId,
  voteTally = {},
  showVoteTally = false,
  onVote,
  hasVoted,
  allowedVoteIds,
  onKick,
  isHost = false,
  currentSpeakerId = null,
  revealSubmittedIds = [],
}: PlayerListProps): JSX.Element {
  const isVotePhase = onVote !== undefined;

  return (
    <div className="flex flex-col gap-2">
      {players.map((player) => {
        const isOwn = player.playerId === ownPlayerId;
        const isEliminated = player.status === 'SPECTATOR';
        const isReconnecting = player.status === 'RECONNECTING';
        const isSpeaking = currentSpeakerId === player.playerId && !isEliminated;
        const hasSubmittedReveal = revealSubmittedIds.includes(player.playerId);
        const voteCount = voteTally[player.playerId] ?? 0;
        const canVoteFor =
          isVotePhase &&
          !isOwn &&
          !isEliminated &&
          !hasVoted &&
          (!allowedVoteIds || allowedVoteIds.includes(player.playerId));
        const displayTraits = isOwn
          ? player.visibleTraits.filter((t) => t.isRevealed)
          : player.visibleTraits;

        return (
          <div
            key={player.playerId}
            className={[
              'p-3 rounded border transition-colors duration-150',
              isEliminated
                ? 'border-bunker-border/30 bg-bunker-surface/30 opacity-60'
                : isSpeaking
                  ? 'border-bunker-hot/60 bg-bunker-hot/10 shadow-[0_0_12px_rgba(232,81,10,0.15)]'
                  : 'border-bunker-border bg-bunker-surface',
            ].join(' ')}
          >
            {/* Header row */}
            <div className="flex items-center gap-2 mb-2">
              {player.isHost && <Crown size={14} className="text-bunker-hot shrink-0" />}

              <span
                className={[
                  'font-inter font-medium flex-1 min-w-0 truncate',
                  isEliminated ? 'text-bunker-muted line-through' : 'text-bunker-text',
                ].join(' ')}
              >
                {player.nickname}
              </span>

              {/* Status badges */}
              {isReconnecting && (
                <span className="font-inter text-xs text-bunker-muted animate-pulse shrink-0">
                  {t('game.reconnectingBadge')}
                </span>
              )}
              {isEliminated && (
                <span className="font-inter text-xs text-bunker-muted shrink-0">
                  {t('game.spectator.badge')}
                </span>
              )}
              {isOwn && !isEliminated && (
                <span className="font-inter text-xs text-bunker-muted/60 shrink-0">{t('game.selfBadge')}</span>
              )}
              {isSpeaking && (
                <span className="font-inter text-xs text-bunker-hot shrink-0 animate-pulse">🎤</span>
              )}
              {hasSubmittedReveal && !isEliminated && (
                <span className="font-inter text-xs text-bunker-success shrink-0" title="Вже вибрав">✓</span>
              )}

              {/* Vote count badge — only after all have voted */}
              {isVotePhase && showVoteTally && voteCount > 0 && !isEliminated && (
                <span className="font-mono text-xs text-bunker-danger bg-bunker-danger/10 border border-bunker-danger/30 px-1.5 py-0.5 rounded shrink-0">
                  -{voteCount}
                </span>
              )}

              {/* Vote button */}
              {canVoteFor && (
                <button
                  className="h-8 px-3 rounded bg-bunker-hot/20 border border-bunker-hot/50 text-bunker-hot font-inter text-xs hover:bg-bunker-hot/30 transition-colors duration-150 shrink-0"
                  onClick={() => onVote(player.playerId)}
                >
                  {t('game.vote.button')}
                </button>
              )}

              {/* Kick button — host only, not self, not already eliminated/kicked */}
              {isHost && onKick && !isOwn && !isEliminated && player.status !== 'KICKED' && (
                <button
                  className="h-7 px-2 rounded border border-bunker-danger/40 text-bunker-danger font-inter text-xs hover:bg-bunker-danger/10 transition-colors duration-150 shrink-0"
                  onClick={() => onKick(player.playerId)}
                  title={t('lobby.kickPlayer')}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Revealed traits — own player only shows actually-revealed ones */}
            {displayTraits.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {displayTraits.map((trait) => (
                  <span
                    key={trait.category}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-bunker-bg border border-bunker-border/50 font-inter text-xs text-bunker-muted"
                    title={t(`trait.category.${trait.category}` as Parameters<typeof t>[0])}
                  >
                    <span>{TRAIT_EMOJI[trait.category]}</span>
                    <span className="text-bunker-text">{trait.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
