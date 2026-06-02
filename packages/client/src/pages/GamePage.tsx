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

import { useEffect, useState, useCallback, useRef } from 'react';
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
  HostKickAck,
  HostSkipVoteAck,
  HostEndSessionAck,
  HostStartDebateTimerAck,
  HostNextSpeakerAck,
  RoomJoinPayload,
  RoomJoinAck,
} from '@bunker/shared';
import { socket, getCookie, setCookie, SESSION_TOKEN_KEY, RECONNECT_TOKEN_KEY } from '../socket/socket.js';
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
  voted: boolean;
  onVote: (targetId: string) => void;
}

function TiebreakerModal({
  tiedPlayerIds,
  isHostDeciding,
  decidingPlayerId,
  ownPlayerId,
  players,
  voted,
  onVote,
}: TiebreakerModalProps): JSX.Element {
  const isDecider = ownPlayerId === decidingPlayerId;
  const tiedPlayers = players.filter((p) => tiedPlayerIds.includes(p.playerId));
  const canVote = (!isHostDeciding || isDecider) && !voted;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-bunker-surface border border-bunker-border rounded p-6 max-w-sm w-full mx-4 animate-[fade-in_300ms_ease-out]">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">⚖️</div>
          <h2 className="font-oswald font-bold text-xl text-bunker-text uppercase">
            {isHostDeciding ? t('game.tiebreaker.decidingVote') : t('game.tiebreaker.revote')}
          </h2>
          {isHostDeciding && !isDecider && decidingPlayerId && (
            <p className="font-inter text-sm text-bunker-muted mt-2">
              {players.find((p) => p.playerId === decidingPlayerId)?.nickname ?? ''}{' '}
              {t('game.tiebreaker.decidingLabel')}
            </p>
          )}
          {!isHostDeciding && (
            <p className="font-inter text-sm text-bunker-muted mt-2">
              {t('game.tiebreaker.votingBetweenTied')}
            </p>
          )}
        </div>

        {canVote && (
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

        {voted && (
          <p className="text-center font-inter text-bunker-success text-sm">
            ✓ {t('game.vote.voteCounted')}
          </p>
        )}

        {isHostDeciding && !isDecider && !voted && (
          <p className="text-center font-inter text-bunker-muted text-sm">
            {t('game.tiebreaker.waitingDecision')}
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
    if (isHost) {
      // Host ends session: server cleans up room and emits room:closed to all
      socket.emit(EVENTS.HOST_END_SESSION, (ack: HostEndSessionAck) => {
        if (!ack.ok) console.error('endSession error:', ack.error);
      });
    }
    navigate('/', { state: { message: t('end.thankYou') } });
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

// ── Mobile tab type ───────────────────────────────────────────────────────────

type MobileTab = 'card' | 'players';

// ── Main GamePage ─────────────────────────────────────────────────────────────

function GamePage(): JSX.Element {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();

  const {
    room, players, ownCharacter, ownPlayerId, ownNickname,
    debateTimer, debateTimerEnded, debateSpeakingOrder, debateCurrentSpeakerIndex,
    tiebreaker, isRevealed, votes, voteTally, gameEnded,
    disconnectedVoterPrompt, setDisconnectedVoterPrompt,
    revealWaitingFor, revealSubmittedIds,
  } = useGameStore();

  const [selectedCats, setSelectedCats] = useState<TraitCategory[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [voteChangeUsed, setVoteChangeUsed] = useState(false);
  const [tiebreakerVoted, setTiebreakerVoted] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('card');
  const joinCalledRef = useRef(false);

  useEffect(() => {
    const store = useGameStore.getState();
    const cleanup = registerSocketListeners({
      onKicked: () => navigate('/', { replace: true }),
      onRoomClosed: () => navigate('/', { replace: true, state: { message: t('end.thankYou') } }),
    });

    // If room is already in store (normal navigation from LobbyPage) skip reconnect
    if (store.room) return cleanup;

    // Full page reload — room cleared from memory, attempt reconnect using cookies
    const reconnectToken = getCookie(RECONNECT_TOKEN_KEY);
    if (!reconnectToken) { navigate('/'); return cleanup; }

    // Guard against React StrictMode double-invoke
    if (joinCalledRef.current) return cleanup;
    joinCalledRef.current = true;

    const run = async (): Promise<void> => {
      if (!socket.connected) {
        socket.connect();
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('connect timeout')), 5000);
          socket.once('connect', () => { clearTimeout(timer); resolve(); });
          socket.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
        });
      }
      await new Promise<void>((resolve) => {
        const payload: RoomJoinPayload = {
          roomCode: (roomCode ?? '').toUpperCase(),
          nickname: '',
          sessionToken: getCookie(SESSION_TOKEN_KEY),
        };
        socket.emit(EVENTS.ROOM_JOIN, payload, (ack: RoomJoinAck) => {
          if (ack.ok) {
            useGameStore.getState().setOwnPlayer(ack.player.playerId, ack.player.nickname);
            setCookie(RECONNECT_TOKEN_KEY, ack.reconnectToken);
            // If room returned to LOBBY state, send player back to the lobby page
            if (ack.room.state === 'LOBBY' || ack.room.state === 'SCENARIO_PICK') {
              navigate(`/r/${roomCode ?? ''}`, { replace: true });
            }
          } else {
            navigate('/');
          }
          resolve();
        });
      });
    };

    run().catch(() => navigate('/'));
    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset per-phase state when phase changes
  useEffect(() => {
    setSelectedCats([]);
    setSubmitError(null);
    setHasVoted(false);
    setVoteChangeUsed(false);
    setTiebreakerVoted(false);
  }, [room?.currentPhase, room?.currentRound]);

  // Reset tiebreaker vote state when a new tiebreak starts
  useEffect(() => {
    if (tiebreaker) {
      setHasVoted(false);
      setTiebreakerVoted(false);
    }
  }, [tiebreaker]);

  // ── Derived values (null-safe — used in callbacks below) ─────────────────
  const ownPlayer = players.find((p) => p.playerId === ownPlayerId);
  const isHost = ownPlayer?.isHost ?? false;
  const isSpectator = ownPlayer?.status === 'SPECTATOR';
  const phase = room?.currentPhase ?? null;
  const round = room?.currentRound ?? null;
  const quota = round === 3 ? 1 : 2;

  // ── Reveal submit ────────────────────────────────────────────────────────
  const handleRevealSubmit = useCallback((): void => {
    if (selectedCats.length !== quota) return;
    const cats = [...selectedCats];
    socket.emit(EVENTS.REVEAL_SUBMIT, { categories: cats }, (ack: RevealSubmitAck) => {
      if (!ack.ok) {
        const errKey = `error.${ack.error}` as Parameters<typeof t>[0];
        setSubmitError(t(errKey));
        return;
      }
      // Blind reveal: server won't send own traits until all submit.
      // Update own character and submitted state immediately from the ack.
      const store = useGameStore.getState();
      store.setIsRevealed(true);
      if (store.ownPlayerId) store.addRevealSubmitted(store.ownPlayerId);
      const { ownCharacter } = store;
      if (ownCharacter) {
        const updatedTraits = { ...ownCharacter.traits };
        for (const cat of cats) {
          updatedTraits[cat] = { ...updatedTraits[cat], isRevealed: true };
        }
        store.setOwnCharacter({ ...ownCharacter, traits: updatedTraits });
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
  const handleVote = useCallback((targetId: string, isTiebreak = false): void => {
    socket.emit(EVENTS.VOTE_SUBMIT, { targetId }, (ack: VoteSubmitAck) => {
      if (ack.ok) {
        if (isTiebreak) {
          setTiebreakerVoted(true);
        } else {
          setHasVoted(true);
        }
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

  const handleKick = useCallback((targetPlayerId: string): void => {
    socket.emit(EVENTS.HOST_KICK, { targetPlayerId }, (ack: HostKickAck) => {
      if (!ack.ok) console.error('kick error:', ack.error);
    });
  }, []);

  const handleStartDebateTimer = useCallback((): void => {
    socket.emit(EVENTS.HOST_START_DEBATE_TIMER, (ack: HostStartDebateTimerAck) => {
      if (!ack.ok) console.error('start debate timer error:', ack.error);
    });
  }, []);

  const handleNextSpeaker = useCallback((): void => {
    socket.emit(EVENTS.HOST_NEXT_SPEAKER, (ack: HostNextSpeakerAck) => {
      if (!ack.ok) console.error('next speaker error:', ack.error);
    });
  }, []);

  const handleSkipVote = useCallback((disconnectedPlayerId: string): void => {
    socket.emit(EVENTS.HOST_SKIP_VOTE, { disconnectedPlayerId }, (ack: HostSkipVoteAck) => {
      if (!ack.ok) console.error('skip vote error:', ack.error);
    });
    setDisconnectedVoterPrompt(null);
  }, [setDisconnectedVoterPrompt]);

  const handleWaitForVoter = useCallback((): void => {
    setDisconnectedVoterPrompt(null);
  }, [setDisconnectedVoterPrompt]);

  // ── Early return after all hooks ──────────────────────────────────────────
  if (!room || gameEnded) {
    if (gameEnded) return <GameOverScreen />;
    return (
      <div className="min-h-screen bg-bunker-bg flex items-center justify-center">
        <p className="font-oswald text-xl text-bunker-muted animate-pulse">{t('game.loading')}</p>
      </div>
    );
  }

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

  // ── Reusable action panel (shared between desktop right-col and mobile sticky bar) ──
  const actionPanel = !isSpectator && (
    <>
      {phase === 'REVEAL' && (
        isRevealed ? (
          <p className="font-inter text-sm text-bunker-muted text-center">
            {t('game.reveal.alreadySubmitted')}
            {revealWaitingFor > 0 && (
              <span className="block mt-1 text-bunker-muted/60">
                {t('game.reveal.waiting', { count: revealWaitingFor })}
              </span>
            )}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
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
          </div>
        )
      )}

      {phase === 'VOTE' && (
        <div className="flex flex-col gap-2">
          <p className="font-inter text-sm text-bunker-muted">
            {t('game.vote.prompt')}
          </p>
          {hasVoted && (
            <div className="flex items-center gap-3">
              <p className="font-inter text-xs text-bunker-success flex-1">
                {t('game.vote.voteCounted')}
                {voteWaitingFor > 0 && (
                  <span className="text-bunker-muted"> {t('game.vote.waiting', { count: voteWaitingFor })}</span>
                )}
              </p>
              {!voteChangeUsed && (
                <button
                  className="h-8 px-3 rounded border border-bunker-border text-bunker-muted font-inter text-xs hover:border-bunker-hot/50 hover:text-bunker-text transition-colors duration-150 shrink-0"
                  onClick={() => { setHasVoted(false); setVoteChangeUsed(true); }}
                >
                  {t('game.vote.changeVote')}
                </button>
              )}
            </div>
          )}
          {!hasVoted && submitError && (
            <p className="font-inter text-xs text-bunker-danger">{submitError}</p>
          )}
        </div>
      )}
    </>
  );

  // ── Left column content (my card) ─────────────────────────────────────────
  const cardColumn = (
    <div className="flex flex-col gap-4">
      {scenario && <ScenarioCard scenario={scenario} playerCount={players.length} />}
      {isSpectator ? (
        <div className="flex flex-col gap-4">
          <div className="bg-bunker-surface border border-bunker-border rounded p-4 text-center">
            <p className="font-oswald text-xl text-bunker-muted">
              {t('game.eliminated.spectator')}
            </p>
            <p className="font-inter text-sm text-bunker-muted/60 mt-1">
              {t('game.spectatorWatching')}
            </p>
          </div>
          {ownCharacter && (
            <OwnCharacterCard character={ownCharacter} showOnlyRevealed={false} />
          )}
        </div>
      ) : ownCharacter ? (
        <OwnCharacterCard
          character={ownCharacter}
          selectableCategories={phase === 'REVEAL' && !isRevealed ? selectableCats : undefined}
          selectedCategories={selectedCats}
          onToggle={phase === 'REVEAL' && !isRevealed ? toggleCat : undefined}
          showOnlyRevealed={phase !== 'REVEAL'}
        />
      ) : null}
    </div>
  );

  // ── Right column content (players + phase panel) ──────────────────────────
  const playersColumn = (
    <div className="flex flex-col gap-4">
      {phase === 'DEBATE' && (
        <DebateTimer
          remaining={debateTimer}
          timerEnded={debateTimerEnded}
          isHost={isHost}
          speakingOrder={debateSpeakingOrder.map((id) => ({
            playerId: id,
            nickname: players.find((p) => p.playerId === id)?.nickname ?? id,
          }))}
          currentSpeakerIndex={debateCurrentSpeakerIndex}
          onStartTimer={handleStartDebateTimer}
          onExtend={handleExtendTimer}
          onForceVote={handleForceVote}
          onNextSpeaker={handleNextSpeaker}
        />
      )}

      {/* Desktop action panel — hidden on mobile (shown in sticky bar instead) */}
      {(phase === 'REVEAL' || phase === 'VOTE') && !isSpectator && (
        <div className="hidden lg:block bg-bunker-surface border border-bunker-border rounded p-4">
          {actionPanel}
        </div>
      )}

      <PlayerList
        players={players}
        ownPlayerId={ownPlayerId}
        voteTally={voteTally}
        showVoteTally={voteWaitingFor === 0}
        onVote={phase === 'VOTE' && !isSpectator && !hasVoted && !tiebreaker
          ? handleVote : undefined}
        hasVoted={hasVoted}
        allowedVoteIds={tiebreaker?.tiedPlayerIds}
        onKick={isHost ? handleKick : undefined}
        isHost={isHost}
        currentSpeakerId={phase === 'DEBATE'
          ? (debateSpeakingOrder[debateCurrentSpeakerIndex] ?? null)
          : null}
        revealSubmittedIds={phase === 'REVEAL' ? revealSubmittedIds : []}
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-bunker-bg text-bunker-text flex flex-col">
      {/* How to play overlay */}
      {showHowToPlay && <HowToPlayOverlay onClose={() => setShowHowToPlay(false)} />}

      {/* Tiebreaker modal — only shown to living players */}
      {tiebreaker && !isSpectator && (
        <TiebreakerModal
          tiedPlayerIds={tiebreaker.tiedPlayerIds}
          isHostDeciding={tiebreaker.isHostDeciding}
          decidingPlayerId={tiebreaker.decidingPlayerId}
          ownPlayerId={ownPlayerId}
          players={players}
          voted={tiebreakerVoted}
          onVote={(targetId) => handleVote(targetId, true)}
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

      {/* Sticky header — compact on mobile */}
      <header className="border-b border-bunker-border bg-bunker-surface/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-3 md:px-4 py-2 md:py-3 flex items-center justify-between gap-2 md:gap-4">
          <div className="flex items-center gap-2 md:gap-3">
            <button
              className="font-oswald font-bold text-base md:text-xl text-bunker-hot hover:text-bunker-glow transition-colors duration-150"
              onClick={() => navigate('/')}
            >БУНКЕР</button>
            {round && (
              <span className="font-inter text-xs text-bunker-muted bg-bunker-bg px-2 py-1 rounded border border-bunker-border">
                {t('game.round', { number: round })}
              </span>
            )}
          </div>
          <PhaseLabel phase={phase} />
          <div className="flex items-center gap-2 md:gap-3">
            {ownNickname && (
              <span className="font-inter text-sm text-bunker-text/80 bg-bunker-surface border border-bunker-border px-2 py-0.5 rounded truncate max-w-[100px]">
                {ownNickname}
              </span>
            )}
            <span className="hidden sm:inline font-mono text-sm text-bunker-muted/60">{roomCode}</span>
            <button
              className="p-1.5 text-bunker-muted hover:text-bunker-text transition-colors duration-150"
              onClick={() => setShowHowToPlay(true)}
              title={t('howToPlay.title')}
            >
              <HelpCircle size={16} />
            </button>
            {isHost && (
              <button
                className="h-8 px-2 md:px-3 rounded border border-bunker-danger/40 text-bunker-danger font-inter text-xs hover:bg-bunker-danger/10 transition-colors duration-150"
                onClick={() => setShowEndConfirm(true)}
              >
                {t('host.endGame')}
              </button>
            )}
          </div>
        </div>

        {/* Mobile tab switcher — below the top bar, hidden on lg+ */}
        <div className="lg:hidden flex border-t border-bunker-border">
          <button
            className={`flex-1 py-2 font-oswald font-semibold text-sm uppercase tracking-[0.1em] transition-colors duration-150 ${
              mobileTab === 'card'
                ? 'text-bunker-text border-b-2 border-bunker-hot'
                : 'text-bunker-muted border-b-2 border-transparent'
            }`}
            onClick={() => setMobileTab('card')}
          >
            {t('game.card.ownCard')}
          </button>
          <button
            className={`flex-1 py-2 font-oswald font-semibold text-sm uppercase tracking-[0.1em] transition-colors duration-150 ${
              mobileTab === 'players'
                ? 'text-bunker-text border-b-2 border-bunker-hot'
                : 'text-bunker-muted border-b-2 border-transparent'
            }`}
            onClick={() => setMobileTab('players')}
          >
            {t('game.players')}
          </button>
        </div>
      </header>

      {/* Main layout: tabs on mobile, two-column on lg+ */}
      {/* Add bottom padding on mobile when action bar is visible */}
      <main className={`flex-1 max-w-5xl mx-auto w-full px-3 md:px-4 py-4 md:py-6 lg:grid lg:grid-cols-[1fr_1fr] lg:gap-6 ${
        (phase === 'REVEAL' || phase === 'VOTE') && !isSpectator ? 'pb-24 lg:pb-6' : ''
      }`}>

        {/* Desktop: both columns always visible */}
        <div className="hidden lg:contents">
          {cardColumn}
          {playersColumn}
        </div>

        {/* Mobile: show active tab only */}
        <div className="lg:hidden">
          {mobileTab === 'card' ? cardColumn : playersColumn}
        </div>
      </main>

      {/* Mobile sticky action bar — only shown for REVEAL / VOTE phases, hidden on lg+ */}
      {(phase === 'REVEAL' || phase === 'VOTE') && !isSpectator && (
        <div className="fixed bottom-0 left-0 right-0 bg-bunker-surface border-t border-bunker-border p-3 lg:hidden z-20">
          {actionPanel}
        </div>
      )}
    </div>
  );
}

export default GamePage;
