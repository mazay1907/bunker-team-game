/**
 * Home page — "Створити кімнату" and "Приєднатися за кодом" actions.
 * All strings from uk.json via t().
 */

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n/t.js';
import { socket, SESSION_TOKEN_KEY, RECONNECT_TOKEN_KEY } from '../socket/socket.js';
import { useGameStore } from '../store/gameStore.js';
import { EVENTS } from '@bunker/shared';
import type { RoomJoinPayload, RoomJoinAck, CreateRoomResponse } from '@bunker/shared';

function HomePage(): JSX.Element {
  const navigate = useNavigate();
  const { setOwnPlayer, setRoom, setPlayers, setLastError } = useGameStore();

  // Create room form state
  const [createNickname, setCreateNickname] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Join room form state
  const [joinNickname, setJoinNickname] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  const validateNickname = (nick: string): string | null => {
    const trimmed = nick.trim();
    if (trimmed.length < 2) return t('error.invalidNickname');
    if (trimmed.length > 20) return t('error.invalidNickname');
    return null;
  };

  const handleCreateRoom = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const nickErr = validateNickname(createNickname);
    if (nickErr) {
      setCreateError(nickErr);
      return;
    }

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

      // Store both tokens in localStorage
      localStorage.setItem(SESSION_TOKEN_KEY, data.sessionToken);
      localStorage.setItem(RECONNECT_TOKEN_KEY, data.reconnectToken);

      // Track own identity
      setOwnPlayer(data.playerId, createNickname.trim());

      // Connect socket and join the room
      socket.connect();

      // Wait for connection then emit room:join
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('connect timeout')), 5000);

        if (socket.connected) {
          clearTimeout(timeout);
          resolve();
        } else {
          socket.once('connect', () => {
            clearTimeout(timeout);
            resolve();
          });
          socket.once('connect_error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        }
      });

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
            // Store reconnect token from ack
            localStorage.setItem(RECONNECT_TOKEN_KEY, ack.reconnectToken);
            resolve();
          } else {
            reject(new Error(ack.error));
          }
        });
      });

      navigate(`/r/${data.roomCode}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : t('error.networkError');
      setCreateError(
        (t(`error.${errorMsg}` as Parameters<typeof t>[0]) as string | undefined) ??
          t('error.networkError'),
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const nickErr = validateNickname(joinNickname);
    if (nickErr) {
      setJoinError(nickErr);
      return;
    }

    const codeUpper = joinCode.trim().toUpperCase();
    if (codeUpper.length !== 6) {
      setJoinError(t('error.roomNotFound'));
      return;
    }

    setJoinError(null);
    setIsJoining(true);

    try {
      // Navigate to the room — the LobbyPage handles the actual socket join
      setOwnPlayer('', joinNickname.trim());
      navigate(`/r/${codeUpper}`, {
        state: { nickname: joinNickname.trim() },
      });
    } catch (err) {
      setJoinError(t('error.networkError'));
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="home-page">
      <h1>{t('app.title')}</h1>

      {/* Create Room */}
      <section className="home-section">
        <h2>{t('home.createRoom')}</h2>
        <form onSubmit={(e) => void handleCreateRoom(e)}>
          <div className="form-group">
            <label htmlFor="create-nickname">{t('home.nicknameLabel')}</label>
            <input
              id="create-nickname"
              type="text"
              value={createNickname}
              onChange={(e) => setCreateNickname(e.target.value)}
              placeholder={t('home.nicknamePlaceholder')}
              maxLength={20}
              disabled={isCreating}
              autoComplete="off"
            />
            {createError && <span className="error-msg">{createError}</span>}
          </div>
          <button type="submit" disabled={isCreating || createNickname.trim().length < 2}>
            {isCreating ? '…' : t('home.createButton')}
          </button>
        </form>
      </section>

      {/* Join by Code */}
      <section className="home-section">
        <h2>{t('home.joinRoom')}</h2>
        <form onSubmit={(e) => void handleJoinRoom(e)}>
          <div className="form-group">
            <label htmlFor="join-nickname">{t('home.nicknameLabel')}</label>
            <input
              id="join-nickname"
              type="text"
              value={joinNickname}
              onChange={(e) => setJoinNickname(e.target.value)}
              placeholder={t('home.nicknamePlaceholder')}
              maxLength={20}
              disabled={isJoining}
              autoComplete="off"
            />
          </div>
          <div className="form-group">
            <label htmlFor="join-code">{t('home.roomCodeLabel')}</label>
            <input
              id="join-code"
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder={t('home.roomCodePlaceholder')}
              maxLength={6}
              disabled={isJoining}
              autoComplete="off"
            />
          </div>
          {joinError && <span className="error-msg">{joinError}</span>}
          <button
            type="submit"
            disabled={
              isJoining ||
              joinNickname.trim().length < 2 ||
              joinCode.trim().length !== 6
            }
          >
            {isJoining ? '…' : t('home.joinButton')}
          </button>
        </form>
      </section>
    </div>
  );
}

export default HomePage;
