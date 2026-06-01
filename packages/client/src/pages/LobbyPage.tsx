/**
 * LobbyPage — shown after joining a room, before the game starts.
 *
 * Handles:
 * - Socket join on first mount
 * - Real-time player list updates
 * - Host actions: kick, start game
 * - Scenario picker modal (SCENARIO_PICK phase)
 * - Redirect to game once R1_REVEAL begins
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Copy, Check, Crown, X, Users, HelpCircle } from 'lucide-react';
import { socket, RECONNECT_TOKEN_KEY, SESSION_TOKEN_KEY, claimSession } from '../socket/socket.js';
import { useGameStore } from '../store/gameStore.js';
import { EVENTS } from '@bunker/shared';
import type {
  RoomJoinPayload,
  RoomJoinAck,
  HostKickAck,
  HostStartGameAck,
  HostPickScenarioAck,
} from '@bunker/shared';
import { t } from '../i18n/t.js';
import { registerSocketListeners } from '../socket/listeners.js';
import { HowToPlayOverlay } from '../components/game/HowToPlayOverlay.js';

interface LocationState {
  nickname?: string;
}

// ── Style constants ──────────────────────────────────────────────────────────

const btnPrimary =
  'h-14 px-8 rounded bg-bunker-hot text-white font-oswald font-semibold text-lg ' +
  'uppercase tracking-[0.1em] flex items-center justify-center gap-2 ' +
  'hover:bg-bunker-glow hover:shadow-[0_0_24px_rgba(232,81,10,0.5)] ' +
  'disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200';

const btnSecondary =
  'h-9 px-4 rounded border border-bunker-border text-bunker-muted font-inter text-sm ' +
  'hover:border-bunker-hot hover:text-bunker-text transition-colors duration-150 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

const btnDanger =
  'h-8 px-3 rounded border border-bunker-danger/50 text-bunker-danger font-inter text-xs ' +
  'hover:bg-bunker-danger/10 transition-colors duration-150';

// ── ScenarioPicker ───────────────────────────────────────────────────────────

interface ScenarioPickerProps {
  isHost: boolean;
  onPick: (scenarioId: string) => void;
}

function ScenarioPicker({ isHost, onPick }: ScenarioPickerProps): JSX.Element {
  const scenarios = useGameStore((s) => s.availableScenarios);
  const [selected, setSelected] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);

  const handleConfirm = async (): Promise<void> => {
    if (!selected) return;
    setIsPicking(true);
    await new Promise<void>((resolve) => {
      socket.emit(EVENTS.HOST_PICK_SCENARIO, { scenarioId: selected }, (ack: HostPickScenarioAck) => {
        if (!ack.ok) console.error('pickScenario error:', ack.error);
        resolve();
      });
    });
    onPick(selected);
    setIsPicking(false);
  };

  if (!isHost) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="bg-bunker-surface border border-bunker-border rounded p-8 max-w-sm w-full mx-4 text-center animate-[fade-in_300ms_ease-out]">
          <div className="text-4xl mb-4">☢</div>
          <p className="font-oswald text-xl text-bunker-text">{t('scenario.pick.waiting')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-bunker-surface border border-bunker-border rounded p-6 max-w-lg w-full mx-4 animate-[fade-in_300ms_ease-out]">
        <h2 className="font-oswald font-bold text-2xl text-bunker-text uppercase tracking-wider mb-6">
          {t('scenario.pick.title')}
        </h2>

        <div className="flex flex-col gap-3 mb-6 max-h-80 overflow-y-auto">
          {/* Random option */}
          <button
            className={`p-4 rounded border text-left transition-colors duration-150 ${
              selected === 'RANDOM'
                ? 'border-bunker-hot bg-bunker-hot/10 text-bunker-text'
                : 'border-bunker-border hover:border-bunker-hot/50 text-bunker-muted hover:text-bunker-text'
            }`}
            onClick={() => setSelected('RANDOM')}
          >
            <div className="font-oswald font-semibold text-lg">
              🎲 {t('scenario.pick.random')}
            </div>
          </button>

          {scenarios.map((s) => (
            <button
              key={s.id}
              className={`p-4 rounded border text-left transition-colors duration-150 ${
                selected === s.id
                  ? 'border-bunker-hot bg-bunker-hot/10'
                  : 'border-bunker-border hover:border-bunker-hot/50'
              }`}
              onClick={() => setSelected(s.id)}
            >
              <div className="font-oswald font-semibold text-base text-bunker-text">
                {s.title}
              </div>
              <p className="font-inter text-sm text-bunker-muted mt-1 line-clamp-2">
                {s.description}
              </p>
              <div className="flex gap-4 mt-2 text-xs text-bunker-muted/70 font-mono">
                <span>{t('game.capacity')}: {s.bunkerConditions.capacity}</span>
                <span>{t('game.supplyDuration')}: {s.bunkerConditions.supplyDuration}</span>
              </div>
            </button>
          ))}
        </div>

        <button
          className={btnPrimary + ' w-full'}
          disabled={!selected || isPicking}
          onClick={() => void handleConfirm()}
        >
          {isPicking ? '…' : t('scenario.pick.confirm')}
        </button>
      </div>
    </div>
  );
}

// ── Main LobbyPage ───────────────────────────────────────────────────────────

function LobbyPage(): JSX.Element {
  const { roomCode } = useParams<{ roomCode: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = location.state as LocationState | null;

  const {
    room, players, ownPlayerId, availableScenarios,
    setRoom, setPlayers, setOwnPlayer, setLastError, lastError,
  } = useGameStore();

  const [isJoining, setIsJoining] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);

  // Navigate to game when game starts
  useEffect(() => {
    if (!room) return;
    const gameStates = [
      'R1_REVEAL', 'R1_DEBATE', 'R1_VOTE',
      'R2_REVEAL', 'R2_DEBATE', 'R2_VOTE',
      'R3_REVEAL', 'R3_DEBATE', 'R3_VOTE',
    ];
    if (gameStates.includes(room.state)) {
      navigate(`/game/${roomCode ?? ''}`, { replace: true });
    }
    if (room.state === 'ENDED') {
      navigate(`/game/${roomCode ?? ''}`, { replace: true });
    }
  }, [room?.state, roomCode, navigate]);

  useEffect(() => {
    if (!roomCode) { navigate('/'); return; }

    const cleanup = registerSocketListeners({
      onKicked: () => {
        navigate('/', { replace: true });
      },
    });

    const nickname = locationState?.nickname;
    const sessionToken = localStorage.getItem(SESSION_TOKEN_KEY);

    const joinRoom = async (): Promise<void> => {
      setIsJoining(true);

      if (!socket.connected) {
        socket.connect();
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('connect timeout')), 5000);
          socket.once('connect', () => { clearTimeout(timeout); resolve(); });
          socket.once('connect_error', (err) => { clearTimeout(timeout); reject(err); });
        });
      }
      // Tell other tabs that this tab is claiming the session
      claimSession();

      const payload: RoomJoinPayload = {
        roomCode: roomCode.toUpperCase(),
        nickname: nickname ?? '',
        sessionToken,
      };

      await new Promise<void>((resolve) => {
        socket.emit(EVENTS.ROOM_JOIN, payload, (ack: RoomJoinAck) => {
          if (ack.ok) {
            setRoom(ack.room);
            setPlayers([ack.player]);
            if (nickname) setOwnPlayer(ack.player.playerId, nickname);
            localStorage.setItem(RECONNECT_TOKEN_KEY, ack.reconnectToken);
          } else {
            // Show error inline — do not navigate away so the user sees a clear error page
            const errKey = `error.${ack.error}` as Parameters<typeof t>[0];
            setLastError(t(errKey));
          }
          resolve();
        });
      });

      setIsJoining(false);
    };

    void joinRoom().catch((err: unknown) => {
      console.error('[LobbyPage] join error:', err);
      setLastError(t('error.networkError'));
      setIsJoining(false);
    });

    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  const handleCopyLink = useCallback(async (): Promise<void> => {
    const url = `${window.location.origin}/r/${roomCode ?? ''}`;
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }, [roomCode]);

  const handleKick = useCallback((targetPlayerId: string): void => {
    socket.emit(EVENTS.HOST_KICK, { targetPlayerId }, (ack: HostKickAck) => {
      if (!ack.ok) console.error('kick error:', ack.error);
    });
  }, []);

  const handleStartGame = useCallback((): void => {
    socket.emit(EVENTS.HOST_START_GAME, (ack: HostStartGameAck) => {
      if (!ack.ok) {
        const errKey = `error.${ack.error}` as Parameters<typeof t>[0];
        setLastError(t(errKey));
      }
    });
  }, [setLastError]);

  const ownPlayer = players.find((p) => p.playerId === ownPlayerId);
  const isHost = ownPlayer?.isHost ?? false;
  const playerCount = players.length;
  const canStart = playerCount >= 6 && playerCount <= 10;
  const isScenarioPick = room?.state === 'SCENARIO_PICK';

  if (isJoining) {
    return (
      <div className="min-h-screen bg-bunker-bg flex items-center justify-center">
        <p className="font-oswald text-xl text-bunker-muted animate-pulse">
          {t('lobby.connecting')}
        </p>
      </div>
    );
  }

  if (lastError === 'SESSION_TRANSFERRED') {
    return (
      <div className="min-h-screen bg-bunker-bg flex items-center justify-center">
        <div className="text-center p-8 max-w-sm">
          <p className="font-inter text-bunker-muted mb-6">
            {t('error.SESSION_TRANSFERRED')}
          </p>
          <button className={btnPrimary} onClick={() => navigate('/')}>
            {t('end.createNew')}
          </button>
        </div>
      </div>
    );
  }

  if (lastError && !room) {
    return (
      <div className="min-h-screen bg-bunker-bg flex items-center justify-center">
        <div className="bg-bunker-surface border border-bunker-border rounded p-8 max-w-sm w-full mx-4 text-center">
          <div className="text-4xl mb-4">⚠</div>
          <p className="font-inter text-bunker-danger mb-6 text-lg">{lastError}</p>
          <button className={btnPrimary} onClick={() => navigate('/')}>
            {t('error.goHome')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bunker-bg text-bunker-text flex flex-col">
      {/* How to play overlay */}
      {showHowToPlay && <HowToPlayOverlay onClose={() => setShowHowToPlay(false)} />}

      {/* Scenario picker modal */}
      {isScenarioPick && availableScenarios.length > 0 && (
        <ScenarioPicker isHost={isHost} onPick={() => void 0} />
      )}

      {/* Header */}
      <header className="border-b border-bunker-border bg-bunker-surface/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-3 md:px-4 py-2 md:py-3 flex items-center justify-between gap-2 md:gap-4">
          <span className="font-oswald font-bold text-lg md:text-xl text-bunker-hot uppercase tracking-wider shrink-0">
            БУНКЕР
          </span>
          <div className="flex items-center gap-1.5 md:gap-2 min-w-0">
            <span className="hidden sm:inline font-inter text-sm text-bunker-muted shrink-0">{t('lobby.roomCode')}:</span>
            <span className="font-mono font-bold text-base md:text-lg text-bunker-text tracking-[0.2em] shrink-0">
              {roomCode}
            </span>
            <button
              className={btnSecondary + ' flex items-center gap-1'}
              onClick={() => void handleCopyLink()}
              title={t('lobby.copyLink')}
            >
              {linkCopied
                ? <><Check size={14} /><span className="hidden sm:inline">{t('lobby.linkCopied')}</span></>
                : <><Copy size={14} /><span className="hidden sm:inline">{t('lobby.copyLink')}</span></>
              }
            </button>
            <button
              className="p-1.5 text-bunker-muted hover:text-bunker-text transition-colors duration-150"
              onClick={() => setShowHowToPlay(true)}
              title={t('howToPlay.title')}
            >
              <HelpCircle size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Main content — single column on mobile, max-width on wider screens */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 md:py-8 flex flex-col gap-6 md:gap-8">

        {/* Title */}
        <div>
          <h1 className="font-oswald font-bold text-3xl text-bunker-text uppercase tracking-wide">
            {t('lobby.title')}
          </h1>
          {isHost && (
            <p className="font-inter text-sm text-bunker-muted mt-1">
              {t('lobby.youAreHost')}
            </p>
          )}
        </div>

        {/* Player list */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Users size={16} className="text-bunker-muted" />
            <h2 className="font-inter text-sm text-bunker-muted uppercase tracking-[0.08em]">
              {t('lobby.playerCount', { count: playerCount })}
            </h2>
          </div>

          <div className="flex flex-col gap-2">
            {players.map((player) => (
              <div
                key={player.playerId}
                className="flex items-center gap-3 p-3 rounded bg-bunker-surface border border-bunker-border"
              >
                {/* Host crown */}
                {player.isHost && (
                  <Crown size={16} className="text-bunker-hot shrink-0" />
                )}
                {!player.isHost && (
                  <div className="w-4 shrink-0" />
                )}

                {/* Nickname */}
                <span className="font-inter text-bunker-text flex-1 min-w-0 truncate">
                  {player.nickname}
                </span>

                {/* Host badge */}
                {player.isHost && (
                  <span className="font-inter text-xs text-bunker-hot/70 shrink-0">
                    {t('lobby.host')}
                  </span>
                )}

                {/* Self badge */}
                {player.playerId === ownPlayerId && !player.isHost && (
                  <span className="font-inter text-xs text-bunker-muted shrink-0">
                    {t('lobby.selfBadge')}
                  </span>
                )}

                {/* Kick button (host only, not self) */}
                {isHost && player.playerId !== ownPlayerId && (
                  <button
                    className={btnDanger}
                    onClick={() => handleKick(player.playerId)}
                    title={t('lobby.kickPlayer')}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Host actions */}
        {isHost && (
          <div className="flex flex-col gap-3">
            <button
              className={btnPrimary}
              disabled={!canStart}
              onClick={handleStartGame}
              title={
                playerCount < 6
                  ? t('lobby.waitingForPlayers')
                  : playerCount > 10
                    ? t('lobby.tooManyPlayers')
                    : undefined
              }
            >
              🚀 {t('lobby.startGame')}
            </button>
            {playerCount < 6 && (
              <p className="font-inter text-sm text-bunker-muted text-center">
                {t('lobby.waitingForPlayers')}
              </p>
            )}
          </div>
        )}

        {/* Error */}
        {lastError && (
          <p className="font-inter text-sm text-bunker-danger text-center">{lastError}</p>
        )}
      </main>
    </div>
  );
}

export default LobbyPage;
