/**
 * Lobby page — shown after joining a room, before the game starts.
 * Handles initial socket join on first render.
 */

import { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { socket, RECONNECT_TOKEN_KEY, SESSION_TOKEN_KEY } from '../socket/socket.js';
import { useGameStore } from '../store/gameStore.js';
import { EVENTS } from '@bunker/shared';
import type { RoomJoinPayload, RoomJoinAck, PlayerJoinedPayload, PlayerLeftPayload } from '@bunker/shared';
import { t } from '../i18n/t.js';
import { registerSocketListeners } from '../socket/listeners.js';

interface LocationState {
  nickname?: string;
}

function LobbyPage(): JSX.Element {
  const { roomCode } = useParams<{ roomCode: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = location.state as LocationState | null;

  const { room, players, ownPlayerId, setRoom, setPlayers, setOwnPlayer, updatePlayer, removePlayer, setLastError, lastError } =
    useGameStore();

  const [isJoining, setIsJoining] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    if (!roomCode) {
      navigate('/');
      return;
    }

    // Register socket event listeners
    const cleanup = registerSocketListeners();

    // If we have a nickname from navigation state, we need to join first
    const nickname = locationState?.nickname;
    const sessionToken = localStorage.getItem(SESSION_TOKEN_KEY);

    // Connect and join
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
            const errKey = `error.${ack.error}` as Parameters<typeof t>[0];
            setLastError(t(errKey));
            navigate('/');
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
  }, [roomCode]);

  const handleCopyLink = async (): Promise<void> => {
    const url = `${window.location.origin}/r/${roomCode ?? ''}`;
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const ownPlayer = players.find((p) => p.playerId === ownPlayerId);
  const isHost = ownPlayer?.isHost ?? false;
  const playerCount = players.length;
  const canStart = playerCount >= 6 && playerCount <= 10;

  if (isJoining) {
    return <div className="loading">Підключаємось…</div>;
  }

  if (lastError) {
    return (
      <div className="error-page">
        <p>{lastError}</p>
        <button onClick={() => navigate('/')}>{t('end.createNew')}</button>
      </div>
    );
  }

  return (
    <div className="lobby-page">
      <h1>{t('lobby.title')}</h1>

      <div className="room-code-section">
        <span>{t('lobby.roomCode')}:</span>
        <strong className="room-code">{roomCode}</strong>
        <button onClick={() => void handleCopyLink()} className="copy-link-btn">
          {linkCopied ? t('lobby.linkCopied') : t('lobby.copyLink')}
        </button>
      </div>

      <div className="player-list">
        <h2>{t('lobby.playerCount', { count: playerCount })}</h2>
        {players.map((player) => (
          <div key={player.playerId} className="player-row">
            <span className="player-name">{player.nickname}</span>
            {player.isHost && (
              <span className="host-badge">{t('lobby.host')}</span>
            )}
          </div>
        ))}
      </div>

      {isHost && (
        <div className="host-actions">
          <button
            disabled={!canStart}
            title={
              playerCount < 6
                ? t('lobby.waitingForPlayers')
                : playerCount > 10
                  ? t('lobby.tooManyPlayers')
                  : undefined
            }
          >
            {t('lobby.startGame')}
          </button>
          {!canStart && playerCount < 6 && (
            <p className="info-msg">{t('lobby.waitingForPlayers')}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default LobbyPage;
