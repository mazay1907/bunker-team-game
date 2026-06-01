/**
 * GamePage — full game view for all phases: reveal, debate, vote, game-over.
 *
 * Layout:
 * - Sticky header: round badge, phase label, room code
 * - Left column: scenario card, own character card
 * - Right column: player list + phase-specific action panel
 * - Tiebreak modal overlay
 * - Game-over screen
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import { EVENTS, TRAIT_CATEGORIES } from '@bunker/shared';
import type {
  TraitCategory,
  RevealSubmitAck,
  VoteSubmitAck,
  HostExtendTimerAck,
  HostForceVoteAck,
  HostEndGameAck,
  HostSkipVoteAck,
} from '@bunker/shared';
import { socket } from '../socket/socket.js';
import { useGameStore } from '../store/gameStore.js';
import { t } from '../i18n/t.js';
import { registerSocketListeners } from '../socket/listeners.js';
import { ScenarioCard } from '../components/game/ScenarioCard.js';
import { OwnCharacterCard } from '../components/game/OwnCharacterCard.js';
import { PlayerList } from '../components/game/PlayerList.js';
import { DebateTimer } from '../components/game/DebateTimer.js';
import { HowToPlayOverlay } from '../components/game/HowToPlayOverlay.js';

// ── Button style constants ────────────────────────────────────────────────────

const btnPrimary =
  'h-12 px-6 rounded bg-bunker-hot text-white font-oswald font-semibold text-base ' +
  'uppercase tracking-[0.1em] flex items-center justify-center gap-2 ' +
  'hover:bg-bunker-glow hover:shadow-[0_0_24px_rgba(232,81,10,0.5)] ' +
  'disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200';

// ── Phase header label ────────────────────────────────────────────────────────

function PhaseLabel({ phase }: { phase: string | null }): JSX.Element {
  const labelMap: Record<string, string> = {
    REVEAL: t('game.phase.reveal'),
    DEBATE: t('game.phase.debate'),
    VOTE: t('game.phase.vote'),
  };
  const label = phase ? (labelMap[phase] ?? phase) : '';
  const colorMap: Record<string, string> = {
    REVEAL: 'text-bunker-success',
    DEBATE: 'text-bunker-text',
    VOTE: 'text-bunker-danger',
  };
  return (
    <span className={`font-oswald font-semibold text-sm uppercase tracking-wider ${phase ? (colorMap[phase] ?? 'text-bunker-muted') : 'text-bunker-muted'}`}>
      {label}
    </span>
  );
}

// ── TiebreakerModal ───────────────────────────────────────────────────────────

import type { PlayerView } from '@bunker/shared';

interface TiebreakerModalProps {
  tiedPlayerIds: string[];
  isHostDeciding: boolean;
  decidingPlayerId: string | null;
  ownPlayerId: string | null;
  players: PlayerView[];
  onVote: (targetId: string) => void;
}

function TiebreakerModal({
  tiedPlayerIds,
  isHostDeciding,
  decidingPlayerId,
  ownPlayerId,
  players,
  onVote,
}: TiebreakerModalProps): JSX.Element {
  const isDecider = ownPlayerId === decidingPlayerId;
  const tiedPlayers = players.filter((p) => tiedPlayerIds.includes(p.playerId));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-bunker-surface border border-bunker-border rounded p-6 max-w-sm w-full mx-4 animate-[fade-in_300ms_ease-out]">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">⚖️</div>
          <h2 className="font-oswald font-bold text-xl text-bunker-text uppercase">
            {isHostDeciding ? 'Вирішальний голос' : 'Переголосування'}
          </h2>
          {isHostDeciding && !isDecider && decidingPlayerId && (
            <p className="font-inter text-sm text-bunker-muted mt-2">
              {players.find((p) => p.playerId === decidingPlayerId)?.nickname ?? ''} вирішує
            </p>
          )}
          {!isHostDeciding && (
            <p className="font-inter text-sm text-bunker-muted mt-2">
              Голосуйте між зв'язаними гравцями
            </p>
          )}
        </div>

        {(!isHostDeciding || isDecider) && (
          <div className="flex flex-col gap-3">
            {tiedPlayers.map((player) => (
              <button
                key={player.playerId}
                className="p-3 rounded border border-bunker-danger/40 hover:border-bunker-danger hover:bg-bunker-danger/10 text-bunker-text font-inter text-sm transition-colors duration-150"
                onClick={() => onVote(player.playerId)}
              >
                {player.nickname}
              </button>
            ))}
          </div>
        )}

        {isHostDeciding && !isDecider && (
          <p className="text-center font-inter text-bunker-muted text-sm">
            Очікуємо на рішення…
          </p>
        )}
      </div>
    </div>
  );
}

// ── GameOver screen ───────────────────────────────────────────────────────────

function GameOverScreen(): JSX.Element {
  const navigate = useNavigate();
  const { gameEnded, ownPlayerId, players } = useGameStore();
  const room = useGameStore((s) => s.room);
  const ownPlayer = players.find((p) => p.playerId === ownPlayerId);
  const isHost = ownPlayer?.isHost ?? false;
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  if (!gameEnded) return <></>;

  const isEarlyEnd = gameEnded.reason === 'HOST_ENDED_EARLY';

  const handlePlayAgain = (): void => {
    socket.emit(EVENTS.HOST_PLAY_AGAIN, (ack: { ok: boolean }) => {
      if (ack.ok) navigate(`/r/${room?.roomCode ?? ''}`);
    });
  };

  const handleFinish = (): void => {
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-bunker-bg text-bunker-text flex flex-col">
      <header className="border-b border-bunker-border bg-bunker-surface/50 py-4 px-4 text-center">
        <h1 className="font-oswald font-bold text-3xl text-bunker-hot uppercase tracking-widest">
          {isEarlyEnd ? t('end.earlyEnd') : t('end.title')}
        </h1>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 flex flex-col gap-8">
        <p className="font-inter text-bunker-muted text-center">{gameEnded.outcomeSummary}</p>

        {/* Survivors */}
        <div>
          <h2 className="font-oswald font-bold text-xl text-bunker-success uppercase tracking-wider mb-3">
            🏠 {t('end.survivors')}
          </h2>
          <div className="flex flex-col gap-2">
            {gameEnded.survivors.map((p) => (
              <div key={p.playerId} className="p-3 rounded border border-bunker-success/30 bg-bunker-success/5">
                <p className="font-inter font-medium text-bunker-text">{p.nickname}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {p.visibleTraits.map((trait) => (
                    <span key={trait.category} className="font-inter text-xs px-2 py-0.5 rounded bg-bunker-bg border border-bunker-border/50 text-bunker-muted">
                      {trait.value}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Eliminated */}
        {gameEnded.eliminated.length > 0 && (
          <div>
            <h2 className="font-oswald font-bold text-xl text-bunker-muted uppercase tracking-wider mb-3">
              💀 {t('end.eliminated')}
            </h2>
            <div className="flex flex-col gap-2">
              {gameEnded.eliminated.map((p) => (
                <div key={p.playerId} className="p-3 rounded border border-bunker-border/30 bg-bunker-surface/30 opacity-70">
                  <p className="font-inter font-medium text-bunker-muted line-through">{p.nickname}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {p.visibleTraits.map((trait) => (
                      <span key={trait.category} className="font-inter text-xs px-2 py-0.5 rounded bg-bunker-bg border border-bunker-border/30 text-bunker-muted/60">
                        {trait.value}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t border-bunker-border">
          {isHost && !showEndConfirm && (
            <button className={btnPrimary + ' flex-1'} onClick={handlePlayAgain}>
              🔄 {t('end.playAgain')}
            </button>
          )}
          {!showEndConfirm && (
            <button
              className="flex-1 h-12 rounded border border-bunker-border text-bunker-muted font-inter hover:border-bunker-hot/50 hover:text-bunker-text transition-colors duration-150"
              onClick={handleFinish}
            >
              {t('end.finish')}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

// ── Main GamePage ─────────────────────────────────────────────────────────────

function GamePage(): JSX.Element {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();

  const {
    room, players, ownCharacter, ownPlayerId,
    debateTimer, tiebreaker, isRevealed, votes, voteTally, gameEnded,
    disconnectedVoterPrompt, setDisconnectedVoterPrompt,
    revealWaitingFor,
  } = useGameStore();

  const [selectedCats, setSelectedCats] = useState<TraitCategory[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);

  useEffect(() => {
    const cleanup = registerSocketListeners({
      onKicked: () => navigate('/', { replace: true }),
    });
    return cleanup;
  }, [navigate]);

  // Reset per-phase state when phase changes
  useEffect(() => {
    setSelectedCats([]);
    setSubmitError(null);
    setHasVoted(false);
  }, [room?.currentPhase, room?.currentRound]);

  if (!room || gameEnded) {
    if (gameEnded) return <GameOverScreen />;
    return (
      <div className="min-h-screen bg-bunker-bg flex items-center justify-center">
        <p className="font-oswald text-xl text-bunker-muted animate-pulse">Завантаження…</p>
      </div>
    );
  }

  const ownPlayer = players.find((p) => p.playerId === ownPlayerId);
  const isHost = ownPlayer?.isHost ?? false;
  const isSpectator = ownPlayer?.status === 'SPECTATOR';
  const phase = room.currentPhase;
  const round = room.currentRound;
  const quota = round === 3 ? 1 : 2;

  // ── Reveal submit ────────────────────────────────────────────────────────
  const handleRevealSubmit = useCallback((): void => {
    if (selectedCats.length !== quota) return;
    socket.emit(EVENTS.REVEAL_SUBMIT, { categories: selectedCats }, (ack: RevealSubmitAck) => {
      if (!ack.ok) {
        const errKey = `error.${ack.error}` as Parameters<typeof t>[0];
        setSubmitError(t(errKey));
      }
    });
  }, [selectedCats, quota]);

  const toggleCat = useCallback((cat: TraitCategory): void => {
    setSelectedCats((prev) => {
      if (prev.includes(cat)) return prev.filter((c) => c !== cat);
      if (prev.length >= quota) return prev;
      return [...prev, cat];
    });
  }, [quota]);

  // ── Vote submit ──────────────────────────────────────────────────────────
  const handleVote = useCallback((targetId: string): void => {
    socket.emit(EVENTS.VOTE_SUBMIT, { targetId }, (ack: VoteSubmitAck) => {
      if (ack.ok) {
        setHasVoted(true);
      } else {
        const errKey = `error.${ack.error}` as Parameters<typeof t>[0];
        setSubmitError(t(errKey));
      }
    });
  }, []);

  // ── Host actions ─────────────────────────────────────────────────────────
  const handleExtendTimer = useCallback((): void => {
    socket.emit(EVENTS.HOST_EXTEND_TIMER, (ack: HostExtendTimerAck) => {
      if (!ack.ok) console.error('extend timer error:', ack.error);
    });
  }, []);

  const handleForceVote = useCallback((): void => {
    socket.emit(EVENTS.HOST_FORCE_VOTE, (ack: HostForceVoteAck) => {
      if (!ack.ok) console.error('force vote error:', ack.error);
    });
  }, []);

  const handleEndGame = useCallback((): void => {
    socket.emit(EVENTS.HOST_END_GAME, (ack: HostEndGameAck) => {
      if (!ack.ok) console.error('end game error:', ack.error);
      setShowEndConfirm(false);
    });
  }, []);

  const handleSkipVote = useCallback((disconnectedPlayerId: string): void => {
    socket.emit(EVENTS.HOST_SKIP_VOTE, { disconnectedPlayerId }, (ack: HostSkipVoteAck) => {
      if (!ack.ok) console.error('skip vote error:', ack.error);
    });
    setDisconnectedVoterPrompt(null);
  }, [setDisconnectedVoterPrompt]);

  const handleWaitForVoter = useCallback((): void => {
    // Dismiss the modal — the server will re-prompt after 60 seconds if still disconnected
    setDisconnectedVoterPrompt(null);
  }, [setDisconnectedVoterPrompt]);

  const scenario = room.scenario;

  // Unrevealed categories for reveal phase
  const alreadyRevealedCats = ownCharacter
    ? (Object.values(ownCharacter.traits)
        .filter((s) => s.isRevealed)
        .map((s) => s.category) as TraitCategory[])
    : [];
  const selectableCats = TRAIT_CATEGORIES.filter((c) => !alreadyRevealedCats.includes(c));

  // Number of players who haven't voted yet (used in VOTE phase display)
  const voteWaitingFor = players.filter(
    (p) =>
      (p.status === 'ACTIVE' || p.status === 'RECONNECTING') &&
      !votes.some((v) => v.voterId === p.playerId),
  ).length;

  return (
    <div className="min-h-screen bg-bunker-bg text-bunker-text flex flex-col">
      {/* How to play overlay */}
      {showHowToPlay && <HowToPlayOverlay onClose={() => setShowHowToPlay(false)} />}

      {/* Tiebreaker modal */}
      {tiebreaker && (
        <TiebreakerModal
          tiedPlayerIds={tiebreaker.tiedPlayerIds}
          isHostDeciding={tiebreaker.isHostDeciding}
          decidingPlayerId={tiebreaker.decidingPlayerId}
          ownPlayerId={ownPlayerId}
          players={players}
          onVote={handleVote}
        />
      )}

      {/* Disconnected voter prompt — shown to host only */}
      {disconnectedVoterPrompt && isHost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-bunker-surface border border-bunker-border rounded p-6 max-w-sm w-full mx-4 animate-[fade-in_300ms_ease-out]">
            <p className="font-inter text-bunker-text mb-6 text-center">
              {t('host.disconnectedVoter.title', { nickname: disconnectedVoterPrompt.disconnectedNickname })}
            </p>
            <div className="flex gap-3">
              <button
                className="flex-1 h-12 rounded border border-bunker-border text-bunker-muted font-inter text-sm hover:border-bunker-hot/50 hover:text-bunker-text transition-colors duration-150"
                onClick={handleWaitForVoter}
              >
                {t('host.disconnectedVoter.wait')}
              </button>
              <button
                className="flex-1 h-12 rounded bg-bunker-danger text-white font-oswald font-semibold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity duration-150"
                onClick={() => handleSkipVote(disconnectedVoterPrompt.disconnectedPlayerId)}
              >
                {t('host.disconnectedVoter.skip')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* End game confirmation */}
      {showEndConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-bunker-surface border border-bunker-border rounded p-6 max-w-sm w-full mx-4 animate-[fade-in_300ms_ease-out]">
            <p className="font-inter text-bunker-text mb-6 text-center">
              {t('host.endGame.confirm')}
            </p>
            <div className="flex gap-3">
              <button className="flex-1 h-12 rounded bg-bunker-danger text-white font-oswald font-semibold text-sm uppercase tracking-wider" onClick={handleEndGame}>
                {t('host.endGame.yes')}
              </button>
              <button className="flex-1 h-12 rounded border border-bunker-border text-bunker-muted font-inter" onClick={() => setShowEndConfirm(false)}>
                {t('host.endGame.no')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky header */}
      <header className="border-b border-bunker-border bg-bunker-surface/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="font-oswald font-bold text-xl text-bunker-hot">БУНКЕР</span>
            {round && (
              <span className="font-inter text-xs text-bunker-muted bg-bunker-bg px-2 py-1 rounded border border-bunker-border">
                {t('game.round', { number: round })}
              </span>
            )}
          </div>
          <PhaseLabel phase={phase} />
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-bunker-muted/60">{roomCode}</span>
            <button
              className="p-1.5 text-bunker-muted hover:text-bunker-text transition-colors duration-150"
              onClick={() => setShowHowToPlay(true)}
              title={t('howToPlay.title')}
            >
              <HelpCircle size={16} />
            </button>
            {isHost && (
              <button
                className="h-8 px-3 rounded border border-bunker-danger/40 text-bunker-danger font-inter text-xs hover:bg-bunker-danger/10 transition-colors duration-150"
                onClick={() => setShowEndConfirm(true)}
              >
                {t('host.endGame')}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main layout: two-column on wide, stacked on narrow */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">

        {/* Left column: scenario + own card */}
        <div className="flex flex-col gap-4">
          {scenario && <ScenarioCard scenario={scenario} />}

          {isSpectator ? (
            <div className="bg-bunker-surface border border-bunker-border rounded p-4 text-center">
              <p className="font-oswald text-xl text-bunker-muted">
                {t('game.eliminated.spectator')}
              </p>
              <p className="font-inter text-sm text-bunker-muted/60 mt-1">
                👁 Ви спостерігаєте
              </p>
            </div>
          ) : ownCharacter ? (
            <OwnCharacterCard
              character={ownCharacter}
              selectableCategories={phase === 'REVEAL' && !isRevealed ? selectableCats : undefined}
              selectedCategories={selectedCats}
              onToggle={phase === 'REVEAL' && !isRevealed ? toggleCat : undefined}
            />
          ) : null}
        </div>

        {/* Right column: players + phase panel */}
        <div className="flex flex-col gap-4">

          {/* Debate timer */}
          {phase === 'DEBATE' && (
            <DebateTimer
              remaining={debateTimer}
              isHost={isHost}
              onExtend={handleExtendTimer}
              onForceVote={handleForceVote}
            />
          )}

          {/* Phase action panel */}
          {phase === 'REVEAL' && !isSpectator && (
            <div className="bg-bunker-surface border border-bunker-border rounded p-4 flex flex-col gap-3">
              {isRevealed ? (
                <p className="font-inter text-sm text-bunker-muted text-center">
                  {t('game.reveal.alreadySubmitted')}
                  {revealWaitingFor > 0 && (
                    <span className="block mt-1 text-bunker-muted/60">
                      {t('game.reveal.waiting', { count: revealWaitingFor })}
                    </span>
                  )}
                </p>
              ) : (
                <>
                  <p className="font-inter text-sm text-bunker-muted">
                    {quota === 2 ? t('game.reveal.prompt.2') : t('game.reveal.prompt.1')}
                    {' '}({selectedCats.length}/{quota})
                  </p>
                  {submitError && (
                    <p className="font-inter text-xs text-bunker-danger">{submitError}</p>
                  )}
                  <button
                    className={btnPrimary}
                    disabled={selectedCats.length !== quota}
                    onClick={handleRevealSubmit}
                  >
                    {t('game.reveal.confirm')}
                  </button>
                </>
              )}
            </div>
          )}

          {phase === 'VOTE' && !isSpectator && (
            <div className="bg-bunker-surface border border-bunker-border rounded p-4">
              <p className="font-inter text-sm text-bunker-muted mb-2">
                {t('game.vote.prompt')}
              </p>
              {hasVoted ? (
                <p className="font-inter text-xs text-bunker-success">
                  ✓ Ваш голос зараховано.
                  {voteWaitingFor > 0 && (
                    <span className="text-bunker-muted"> {t('game.vote.waiting', { count: voteWaitingFor })}</span>
                  )}
                </p>
              ) : submitError ? (
                <p className="font-inter text-xs text-bunker-danger">{submitError}</p>
              ) : null}
            </div>
          )}

          {/* Player list */}
          <PlayerList
            players={players}
            ownPlayerId={ownPlayerId}
            voteTally={voteTally}
            onVote={phase === 'VOTE' && !isSpectator && !hasVoted && !tiebreaker
              ? handleVote : undefined}
            hasVoted={hasVoted}
            allowedVoteIds={tiebreaker?.tiedPlayerIds}
          />
        </div>
      </main>
    </div>
  );
}

export default GamePage;
