/**
 * Socket.IO event listeners that update the Zustand store.
 * These run outside React's render cycle — Zustand handles that correctly.
 *
 * Call registerSocketListeners() once when a room page mounts.
 * Returns a cleanup function to remove all listeners.
 */

import { socket } from './socket.js';
import { useGameStore } from '../store/gameStore.js';
import { EVENTS } from '@bunker/shared';
import type {
  RoomStatePayload,
  PlayerJoinedPayload,
  PlayerLeftPayload,
  PlayerReconnectingPayload,
  PlayerReconnectedPayload,
  PhaseChangedPayload,
  RevealUpdatePayload,
  VoteUpdatePayload,
  PlayerEliminatedPayload,
  GameEndedPayload,
  GameStartedPayload,
} from '@bunker/shared';

export function registerSocketListeners(): () => void {
  const store = useGameStore.getState();

  // ── room:state — full re-sync on join or reconnect ────────────────────────
  const onRoomState = (payload: RoomStatePayload): void => {
    store.setRoom(payload.room);
    store.setPlayers(payload.players);
    store.setOwnCharacter(payload.ownCharacter);
    if (payload.game) store.setGame(payload.game);
  };

  // ── player:joined — another player joined the lobby ─────────────────────
  const onPlayerJoined = (payload: PlayerJoinedPayload): void => {
    const current = useGameStore.getState();
    const exists = current.players.some((p) => p.playerId === payload.player.playerId);
    if (!exists) {
      store.setPlayers([...current.players, payload.player]);
    }
  };

  // ── player:left — player left the lobby ──────────────────────────────────
  const onPlayerLeft = (payload: PlayerLeftPayload): void => {
    store.removePlayer(payload.playerId);
    if (payload.newHostId) {
      const current = useGameStore.getState();
      const updatedPlayers = current.players.map((p) => ({
        ...p,
        isHost: p.playerId === payload.newHostId,
      }));
      store.setPlayers(updatedPlayers);
    }
  };

  // ── player:reconnecting — player disconnected mid-game ───────────────────
  const onPlayerReconnecting = (payload: PlayerReconnectingPayload): void => {
    const current = useGameStore.getState();
    const player = current.players.find((p) => p.playerId === payload.playerId);
    if (player) {
      store.updatePlayer({ ...player, status: 'RECONNECTING' });
    }
  };

  // ── player:reconnected — player came back ────────────────────────────────
  const onPlayerReconnected = (payload: PlayerReconnectingPayload): void => {
    const current = useGameStore.getState();
    const player = current.players.find((p) => p.playerId === payload.playerId);
    if (player) {
      store.updatePlayer({ ...player, status: 'ACTIVE' });
    }
  };

  // ── phase:changed — game phase transitioned ──────────────────────────────
  const onPhaseChanged = (payload: PhaseChangedPayload): void => {
    const current = useGameStore.getState();
    if (current.room) {
      store.setRoom({
        ...current.room,
        state: payload.state,
        currentRound: payload.round,
        currentPhase: payload.phase,
      });
    }
  };

  // ── game:started — scenario picked, characters dealt ────────────────────
  const onGameStarted = (payload: GameStartedPayload): void => {
    const current = useGameStore.getState();
    store.setOwnCharacter(payload.ownCharacter);
    store.setPlayers(payload.players);
    if (current.room) {
      store.setRoom({ ...current.room, scenario: payload.scenario });
    }
  };

  // ── reveal:update — a player revealed traits ─────────────────────────────
  const onRevealUpdate = (payload: RevealUpdatePayload): void => {
    const current = useGameStore.getState();
    const player = current.players.find((p) => p.playerId === payload.playerId);
    if (player) {
      store.updatePlayer({
        ...player,
        visibleTraits: payload.revealedTraits,
      });
    }
  };

  // ── vote:update — a player voted ─────────────────────────────────────────
  const onVoteUpdate = (_payload: VoteUpdatePayload): void => {
    // Vote tally update — handled by game view in Sprint 1
  };

  // ── player:eliminated — a player was voted out ───────────────────────────
  const onPlayerEliminated = (payload: PlayerEliminatedPayload): void => {
    const current = useGameStore.getState();
    const player = current.players.find((p) => p.playerId === payload.playerId);
    if (player) {
      store.updatePlayer({
        ...player,
        status: 'SPECTATOR',
        eliminatedInRound: payload.eliminatedInRound,
        visibleTraits: Object.values(payload.fullCharacter.traits),
      });
    }
  };

  // ── game:ended ────────────────────────────────────────────────────────────
  const onGameEnded = (_payload: GameEndedPayload): void => {
    const current = useGameStore.getState();
    if (current.room) {
      store.setRoom({ ...current.room, state: 'ENDED' });
    }
  };

  // ── connection state ──────────────────────────────────────────────────────
  const onConnect = (): void => store.setConnectionState('connected');
  const onDisconnect = (): void => store.setConnectionState('disconnected');
  const onConnectError = (): void => store.setConnectionState('error');

  // Register all listeners
  socket.on(EVENTS.ROOM_STATE, onRoomState);
  socket.on(EVENTS.PLAYER_JOINED, onPlayerJoined);
  socket.on(EVENTS.PLAYER_LEFT, onPlayerLeft);
  socket.on(EVENTS.PLAYER_RECONNECTING, onPlayerReconnecting);
  socket.on(EVENTS.PLAYER_RECONNECTED, onPlayerReconnected);
  socket.on(EVENTS.PHASE_CHANGED, onPhaseChanged);
  socket.on(EVENTS.GAME_STARTED, onGameStarted);
  socket.on(EVENTS.REVEAL_UPDATE, onRevealUpdate);
  socket.on(EVENTS.VOTE_UPDATE, onVoteUpdate);
  socket.on(EVENTS.PLAYER_ELIMINATED, onPlayerEliminated);
  socket.on(EVENTS.GAME_ENDED, onGameEnded);
  socket.on('connect', onConnect);
  socket.on('disconnect', onDisconnect);
  socket.on('connect_error', onConnectError);

  // Return cleanup function
  return () => {
    socket.off(EVENTS.ROOM_STATE, onRoomState);
    socket.off(EVENTS.PLAYER_JOINED, onPlayerJoined);
    socket.off(EVENTS.PLAYER_LEFT, onPlayerLeft);
    socket.off(EVENTS.PLAYER_RECONNECTING, onPlayerReconnecting);
    socket.off(EVENTS.PLAYER_RECONNECTED, onPlayerReconnected);
    socket.off(EVENTS.PHASE_CHANGED, onPhaseChanged);
    socket.off(EVENTS.GAME_STARTED, onGameStarted);
    socket.off(EVENTS.REVEAL_UPDATE, onRevealUpdate);
    socket.off(EVENTS.VOTE_UPDATE, onVoteUpdate);
    socket.off(EVENTS.PLAYER_ELIMINATED, onPlayerEliminated);
    socket.off(EVENTS.GAME_ENDED, onGameEnded);
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
    socket.off('connect_error', onConnectError);
  };
}
