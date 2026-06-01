import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n/t.js';
import { socket, SESSION_TOKEN_KEY, RECONNECT_TOKEN_KEY, claimSession } from '../socket/socket.js';
import { useGameStore } from '../store/gameStore.js';
import { EVENTS } from '@bunker/shared';
import type { RoomJoinPayload, RoomJoinAck, CreateRoomResponse } from '@bunker/shared';

const inputClass =
  'w-full h-14 px-4 bg-bunker-surface border border-bunker-border rounded ' +
  'font-inter text-base text-bunker-text placeholder:text-bunker-muted ' +
  'focus:outline-none focus:border-bunker-hot focus:ring-2 focus:ring-bunker-hot/20 ' +
  'disabled:opacity-40 transition-colors duration-150';

const primaryBtnClass =
  'w-full h-14 rounded bg-bunker-hot text-white ' +
  'font-oswald font-semibold text-lg uppercase tracking-[0.1em] ' +
  'flex items-center justify-center gap-2 ' +
  'hover:bg-bunker-glow hover:shadow-[0_0_24px_rgba(232,81,10,0.5)] ' +
  'disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200';

const secondaryBtnClass =
  'h-14 w-28 shrink-0 rounded bg-transparent border border-bunker-hot text-bunker-hot ' +
  'font-oswald font-semibold text-lg uppercase tracking-[0.05em] ' +
  'hover:bg-bunker-hot/10 hover:border-bunker-glow ' +
  'disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200';

function HomePage(): JSX.Element {
  const navigate = useNavigate();
  const { setOwnPlayer, setRoom, setPlayers } = useGameStore();

  const [createNickname, setCreateNickname] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [joinNickname, setJoinNickname] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  const validateNickname = (nick: string): string | null => {
    const trimmed = nick.trim();
    if (trimmed.length < 2 || trimmed.length > 20) return t('error.invalidNickname');
    return null;
  };

  const handleCreateRoom = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const nickErr = validateNickname(createNickname);
    if (nickErr) { setCreateError(nickErr); return; }

    setCreateError(null);
    setIsCreating(true);
    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: createNickname.trim() }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setCreateError(body.error ?? t('error.createRoomFailed'));
        return;
      }

      const data = (await response.json()) as CreateRoomResponse;
      localStorage.setItem(SESSION_TOKEN_KEY, data.sessionToken);
      localStorage.setItem(RECONNECT_TOKEN_KEY, data.reconnectToken);
      setOwnPlayer(data.playerId, createNickname.trim());
      socket.connect();

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('connect timeout')), 5000);
        if (socket.connected) { clearTimeout(timeout); resolve(); return; }
        socket.once('connect', () => { clearTimeout(timeout); resolve(); });
        socket.once('connect_error', (err) => { clearTimeout(timeout); reject(err); });
      });
      // Tell other tabs that this tab has claimed the session
      claimSession();

      const joinPayload: RoomJoinPayload = {
        roomCode: data.roomCode,
        nickname: createNickname.trim(),
        sessionToken: data.sessionToken,
      };

      await new Promise<void>((resolve, reject) => {
        socket.emit(EVENTS.ROOM_JOIN, joinPayload, (ack: RoomJoinAck) => {
          if (ack.ok) {
            setRoom(ack.room);
            setPlayers([ack.player]);
            localStorage.setItem(RECONNECT_TOKEN_KEY, ack.reconnectToken);
            resolve();
          } else {
            reject(new Error(ack.error));
          }
        });
      });

      navigate(`/r/${data.roomCode}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('error.networkError');
      setCreateError(
        (t(`error.${msg}` as Parameters<typeof t>[0]) as string | undefined) ??
          t('error.networkError'),
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const nickErr = validateNickname(joinNickname);
    if (nickErr) { setJoinError(nickErr); return; }

    const codeUpper = joinCode.trim().toUpperCase();
    if (codeUpper.length !== 6) { setJoinError(t('error.roomNotFound')); return; }

    setJoinError(null);
    setIsJoining(true);
    try {
      setOwnPlayer('', joinNickname.trim());
      navigate(`/r/${codeUpper}`, { state: { nickname: joinNickname.trim() } });
    } catch {
      setJoinError(t('error.networkError'));
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-bunker-bg flex items-center justify-center overflow-hidden">
      {/* Warm radial glow — single lamp effect */}
      <div className="absolute inset-0 pointer-events-none [background:radial-gradient(ellipse_60%_50%_at_50%_45%,rgba(232,81,10,0.07)_0%,transparent_70%)]" />

      <div className="relative w-full max-w-[480px] px-6 py-12 flex flex-col gap-6">

        {/* Hero */}
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-[64px] leading-none text-bunker-hot select-none">☢</span>
          <h1 className="font-oswald font-bold text-[52px] md:text-[72px] leading-none text-bunker-hot uppercase tracking-wider [text-shadow:0_0_40px_rgba(232,81,10,0.4)]">
            БУНКЕР
          </h1>
          <p className="font-oswald font-light text-lg text-bunker-muted uppercase tracking-[0.15em] mt-1">
            {t('home.subtitle')}
          </p>
        </div>

        {/* Separator */}
        <div className="border-t border-bunker-border" />

        {/* Create room */}
        <form onSubmit={(e) => void handleCreateRoom(e)} className="flex flex-col gap-3">
          <input
            type="text"
            value={createNickname}
            onChange={(e) => setCreateNickname(e.target.value)}
            placeholder={t('home.nicknamePlaceholder')}
            maxLength={20}
            disabled={isCreating}
            autoComplete="off"
            className={inputClass}
          />
          {createError && (
            <span className="font-inter text-sm text-bunker-danger">{createError}</span>
          )}
          <button
            type="submit"
            disabled={isCreating || createNickname.trim().length < 2}
            className={primaryBtnClass}
          >
            <span>🔥</span>
            <span>{isCreating ? '…' : t('home.createButton').toUpperCase()}</span>
          </button>
        </form>

        {/* Or-divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 border-t border-bunker-border" />
          <span className="font-inter text-xs text-bunker-muted uppercase tracking-[0.1em]">
            {t('home.orJoin')}
          </span>
          <div className="flex-1 border-t border-bunker-border" />
        </div>

        {/* Join room */}
        <form onSubmit={(e) => void handleJoinRoom(e)} className="flex flex-col gap-3">
          <input
            type="text"
            value={joinNickname}
            onChange={(e) => setJoinNickname(e.target.value)}
            placeholder={t('home.nicknamePlaceholder')}
            maxLength={20}
            disabled={isJoining}
            autoComplete="off"
            className={inputClass}
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder={t('home.roomCodePlaceholder')}
              maxLength={6}
              disabled={isJoining}
              autoComplete="off"
              className={inputClass + ' font-mono tracking-[0.2em]'}
            />
            <button
              type="submit"
              disabled={isJoining || joinNickname.trim().length < 2 || joinCode.trim().length !== 6}
              className={secondaryBtnClass}
            >
              {isJoining ? '…' : t('home.joinButton').toUpperCase()}
            </button>
          </div>
          {joinError && (
            <span className="font-inter text-sm text-bunker-danger">{joinError}</span>
          )}
        </form>

        {/* Meta */}
        <p className="text-center font-inter text-xs text-bunker-muted/60 uppercase tracking-[0.08em] mt-2">
          {t('home.meta')}
        </p>

      </div>
    </div>
  );
}

export default HomePage;
