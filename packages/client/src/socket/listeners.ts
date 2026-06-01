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
  PhaseChangedPayload,
  RevealUpdatePayload,
  VoteUpdatePayload,
  PlayerEliminatedPayload,
  GameEndedPayload,
  GameStartedPayload,
  ScenariosListPayload,
  TimerTickPayload,
  TimerExtendedPayload,
  VoteTiebreakerPayload,
  HostTransferredPayload,
  PlayerKickedPayload,
  HostDisconnectedVoterPromptPayload,
  RoomClosedPayload,
} from '@bunker/shared';

interface ListenerOptions {
  /** Called when the local player is kicked from the room */
  onKicked?: () => void;
  /** Called when the host ends the session and the room is closed */
  onRoomClosed?: (message: string) => void;
}

export function registerSocketListeners(options?: ListenerOptions): () => void {
  const store = useGameStore.getState();

  // ── room:state — full re-sync on join or reconnect ────────────────────────
  const onRoomState = (payload: RoomStatePayload): void => {
    store.setRoom(payload.room);
    store.setPlayers(payload.players);
    store.setOwnCharacter(payload.ownCharacter);
    if (payload.game) store.setGame(payload.game);
    store.resetRound();
  };

  // ── player:joined — another player joined the lobby ─────────────────────
  const onPlayerJoined = (payload: PlayerJoinedPayload): void => {
    const current = useGameStore.getState();
    const exists = current.players.some((p) => p.playerId === payload.player.playerId);
    if (!exists) {
      store.setPlayers([...current.players, payload.player]);
    }
    // Update room playerCount
    if (current.room) {
      store.setRoom({ ...current.room, playerCount: current.players.length + (exists ? 0 : 1) });
    }
  };

  // ── player:left — player left the lobby ──────────────────────────────────
  const onPlayerLeft = (payload: PlayerLeftPayload): void => {
    store.removePlayer(payload.playerId);
    const current = useGameStore.getState();
    if (payload.newHostId) {
      const updatedPlayers = current.players.map((p) => ({
        ...p,
        isHost: p.playerId === payload.newHostId,
      }));
      store.setPlayers(updatedPlayers);
    }
    if (current.room) {
      store.setRoom({ ...current.room, playerCount: current.players.length });
    }
  };

  // ── player:reconnecting — player disconnected mid-game ───────────────────
  const onPlayerReconnecting = (payload: PlayerReconnectingPayload): void => {
    const current = useGameStore.getState();
    const player = current.players.find((p) => p.playerId === payload.playerId);
    if (player) store.updatePlayer({ ...player, status: 'RECONNECTING' });
  };

  // ── player:reconnected — player came back ────────────────────────────────
  const onPlayerReconnected = (payload: PlayerReconnectingPayload): void => {
    const current = useGameStore.getState();
    const player = current.players.find((p) => p.playerId === payload.playerId);
    if (player) store.updatePlayer({ ...player, status: 'ACTIVE' });
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
    // Reset round-scoped state on new round phases
    if (payload.phase === 'REVEAL' || payload.phase === 'VOTE') {
      store.resetRound();
    }
    if (payload.phase === 'DEBATE') {
      store.setDebateTimer(payload.timerSeconds);
    }
  };

  // ── scenarios:list — host triggered game start ────────────────────────────
  const onScenariosList = (payload: ScenariosListPayload): void => {
    store.setAvailableScenarios(payload.scenarios);
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
      // Merge revealed traits with existing visible traits
      const existingTraits = player.visibleTraits;
      const newTraitCategories = new Set(payload.revealedTraits.map((t) => t.category));
      const merged = [
        ...existingTraits.filter((t) => !newTraitCategories.has(t.category)),
        ...payload.revealedTraits,
      ];
      store.updatePlayer({ ...player, visibleTraits: merged });
    }
    // Track how many players still need to submit
    store.setRevealWaitingFor(payload.waitingFor);
    // Mark own reveal as submitted
    const ownId = useGameStore.getState().ownPlayerId;
    if (payload.playerId === ownId) {
      store.setIsRevealed(true);
    }
  };

  // ── vote:update — a player voted ─────────────────────────────────────────
  const onVoteUpdate = (payload: VoteUpdatePayload): void => {
    store.addVote({
      voterId: payload.voterId,
      targetId: payload.targetId,
      submittedAt: new Date(),
      isAbstention: false,
    });
    store.setVoteTally(payload.tally);
  };

  // ── vote:tiebreaker ───────────────────────────────────────────────────────
  const onVoteTiebreaker = (payload: VoteTiebreakerPayload): void => {
    store.setTiebreaker({
      tiedPlayerIds: payload.tiedPlayerIds,
      isHostDeciding: payload.isHostDeciding,
      decidingPlayerId: payload.decidingPlayerId,
    });
    // Reset votes for re-vote
    store.setVoteTally({});
    const current = useGameStore.getState();
    store.setPlayers(current.players.map((p) => ({ ...p })));
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
  const onGameEnded = (payload: GameEndedPayload): void => {
    const current = useGameStore.getState();
    if (current.room) {
      store.setRoom({ ...current.room, state: 'ENDED' });
    }
    store.setGameEnded({
      reason: payload.reason,
      survivors: payload.survivors,
      eliminated: payload.eliminated,
      outcomeSummary: payload.outcomeSummary,
    });
  };

  // ── timer:tick — debate countdown ─────────────────────────────────────────
  const onTimerTick = (payload: TimerTickPayload): void => {
    store.setDebateTimer(payload.remaining);
  };

  // ── timer:extended — host added time ─────────────────────────────────────
  const onTimerExtended = (payload: TimerExtendedPayload): void => {
    store.setDebateTimer(payload.newRemaining);
  };

  // ── host:transferred — host role changed ─────────────────────────────────
  const onHostTransferred = (payload: HostTransferredPayload): void => {
    const current = useGameStore.getState();
    store.setPlayers(
      current.players.map((p) => ({
        ...p,
        isHost: p.playerId === payload.newHostId,
      })),
    );
  };

  // ── player:kicked — this player was removed from room ────────────────────
  const onPlayerKicked = (_payload: PlayerKickedPayload): void => {
    store.reset();
    options?.onKicked?.();
  };

  // ── host:disconnectedVoterPrompt — host action needed for voter ───────────
  const onDisconnectedVoterPrompt = (payload: HostDisconnectedVoterPromptPayload): void => {
    store.setDisconnectedVoterPrompt({
      disconnectedPlayerId: payload.disconnectedPlayerId,
      disconnectedNickname: payload.disconnectedNickname,
    });
  };

  // ── room:closed — host ended the session, everyone goes home ─────────────
  const onRoomClosed = (payload: RoomClosedPayload): void => {
    store.reset();
    options?.onRoomClosed?.(payload.message);
  };

  // ── connection state ──────────────────────────────────────────────────────
  const onConnect = (): void => store.setConnectionState('connected');
  const onDisconnect = (): void => store.setConnectionState('disconnected');
  const onConnectError = (): void => store.setConnectionState('error');

  // Register all listeners
  socket.on(EVENTS.ROOM_CLOSED, onRoomClosed);
  socket.on(EVENTS.PLAYER_KICKED, onPlayerKicked);
  socket.on(EVENTS.HOST_DISCONNECTED_VOTER_PROMPT, onDisconnectedVoterPrompt);
  socket.on(EVENTS.ROOM_STATE, onRoomState);
  socket.on(EVENTS.PLAYER_JOINED, onPlayerJoined);
  socket.on(EVENTS.PLAYER_LEFT, onPlayerLeft);
  socket.on(EVENTS.PLAYER_RECONNECTING, onPlayerReconnecting);
  socket.on(EVENTS.PLAYER_RECONNECTED, onPlayerReconnected);
  socket.on(EVENTS.PHASE_CHANGED, onPhaseChanged);
  socket.on(EVENTS.SCENARIOS_LIST, onScenariosList);
  socket.on(EVENTS.GAME_STARTED, onGameStarted);
  socket.on(EVENTS.REVEAL_UPDATE, onRevealUpdate);
  socket.on(EVENTS.VOTE_UPDATE, onVoteUpdate);
  socket.on(EVENTS.VOTE_TIEBREAKER, onVoteTiebreaker);
  socket.on(EVENTS.PLAYER_ELIMINATED, onPlayerEliminated);
  socket.on(EVENTS.GAME_ENDED, onGameEnded);
  socket.on(EVENTS.TIMER_TICK, onTimerTick);
  socket.on(EVENTS.TIMER_EXTENDED, onTimerExtended);
  socket.on(EVENTS.HOST_TRANSFERRED, onHostTransferred);
  socket.on('connect', onConnect);
  socket.on('disconnect', onDisconnect);
  socket.on('connect_error', onConnectError);

  return () => {
    socket.off(EVENTS.ROOM_CLOSED, onRoomClosed);
    socket.off(EVENTS.PLAYER_KICKED, onPlayerKicked);
    socket.off(EVENTS.HOST_DISCONNECTED_VOTER_PROMPT, onDisconnectedVoterPrompt);
    socket.off(EVENTS.ROOM_STATE, onRoomState);
    socket.off(EVENTS.PLAYER_JOINED, onPlayerJoined);
    socket.off(EVENTS.PLAYER_LEFT, onPlayerLeft);
    socket.off(EVENTS.PLAYER_RECONNECTING, onPlayerReconnecting);
    socket.off(EVENTS.PLAYER_RECONNECTED, onPlayerReconnected);
    socket.off(EVENTS.PHASE_CHANGED, onPhaseChanged);
    socket.off(EVENTS.SCENARIOS_LIST, onScenariosList);
    socket.off(EVENTS.GAME_STARTED, onGameStarted);
    socket.off(EVENTS.REVEAL_UPDATE, onRevealUpdate);
    socket.off(EVENTS.VOTE_UPDATE, onVoteUpdate);
    socket.off(EVENTS.VOTE_TIEBREAKER, onVoteTiebreaker);
    socket.off(EVENTS.PLAYER_ELIMINATED, onPlayerEliminated);
    socket.off(EVENTS.GAME_ENDED, onGameEnded);
    socket.off(EVENTS.TIMER_TICK, onTimerTick);
    socket.off(EVENTS.TIMER_EXTENDED, onTimerExtended);
    socket.off(EVENTS.HOST_TRANSFERRED, onHostTransferred);
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
    socket.off('connect_error', onConnectError);
  };
}
