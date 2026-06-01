/**
 * All Socket.IO event names and payload types for Bunker Team Game.
 * Both client and server import from this file — no raw string event names elsewhere.
 *
 * Convention: domain:action
 *   Client-to-server: verb (room:join, reveal:submit, vote:submit, host:kick)
 *   Server-to-client: noun/past-tense (room:state, player:joined, phase:changed)
 */

import type {
  RoomState,
  PlayerView,
  RoomView,
  CharacterCard,
  GameView,
  TraitSlot,
  TraitCategory,
  Scenario,
  VoteRecord,
} from './models.js';

// ─── Event name constants ────────────────────────────────────────────────────────

export const EVENTS = {
  // Connection & room
  ROOM_JOIN: 'room:join',
  ROOM_STATE: 'room:state',
  PLAYER_JOINED: 'player:joined',
  PLAYER_LEFT: 'player:left',
  PLAYER_RECONNECTING: 'player:reconnecting',
  PLAYER_RECONNECTED: 'player:reconnected',
  PLAYER_KICKED: 'player:kicked',

  // Host events
  HOST_KICK: 'host:kick',
  HOST_START_GAME: 'host:startGame',
  HOST_PICK_SCENARIO: 'host:pickScenario',
  HOST_EXTEND_TIMER: 'host:extendTimer',
  HOST_FORCE_VOTE: 'host:forceVote',
  HOST_END_GAME: 'host:endGame',
  HOST_PLAY_AGAIN: 'host:playAgain',
  HOST_END_SESSION: 'host:endSession',
  ROOM_CLOSED: 'room:closed',
  HOST_SKIP_VOTE: 'host:skipVote',
  HOST_TRANSFERRED: 'host:transferred',
  HOST_DISCONNECTED_VOTER_PROMPT: 'host:disconnectedVoterPrompt',

  // Game phase
  PHASE_CHANGED: 'phase:changed',
  SCENARIOS_LIST: 'scenarios:list',
  GAME_STARTED: 'game:started',
  GAME_ENDED: 'game:ended',

  // Reveal
  REVEAL_SUBMIT: 'reveal:submit',
  REVEAL_UPDATE: 'reveal:update',

  // Debate timer
  TIMER_TICK: 'timer:tick',
  TIMER_EXTENDED: 'timer:extended',

  // Voting
  VOTE_SUBMIT: 'vote:submit',
  VOTE_UPDATE: 'vote:update',
  VOTE_TIEBREAKER: 'vote:tiebreaker',
  PLAYER_ELIMINATED: 'player:eliminated',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

// ─── Error code types ────────────────────────────────────────────────────────────

export type RoomJoinError = 'ROOM_NOT_FOUND' | 'ROOM_FULL' | 'GAME_IN_PROGRESS' | 'INVALID_NICKNAME';
export type HostKickError = 'NOT_HOST' | 'GAME_STARTED' | 'PLAYER_NOT_FOUND';
export type HostStartGameError = 'NOT_HOST' | 'TOO_FEW_PLAYERS' | 'TOO_MANY_PLAYERS';
export type HostPickScenarioError = 'NOT_HOST' | 'INVALID_SCENARIO';
export type HostExtendTimerError = 'NOT_HOST' | 'WRONG_PHASE';
export type HostForceVoteError = 'NOT_HOST' | 'WRONG_PHASE';
export type HostEndGameError = 'NOT_HOST' | 'WRONG_PHASE';
export type HostPlayAgainError = 'NOT_HOST' | 'WRONG_PHASE';
export type HostEndSessionError = 'NOT_HOST' | 'WRONG_PHASE';
export type HostSkipVoteError = 'NOT_HOST' | 'WRONG_PHASE';
export type RevealSubmitError = 'WRONG_PHASE' | 'WRONG_COUNT' | 'ALREADY_REVEALED' | 'ALREADY_SUBMITTED';
export type VoteSubmitError = 'WRONG_PHASE' | 'SELF_VOTE' | 'ALREADY_VOTED' | 'INVALID_TARGET';

// ─── Client → Server payloads ─────────────────────────────────────────────────

/** Emitted immediately after socket connects — both first join and reconnect */
export interface RoomJoinPayload {
  roomCode: string;
  nickname: string; // required on first join; ignored on reconnect
  sessionToken: string | null; // null on first join; provided on reconnect
}

export interface HostKickPayload {
  targetPlayerId: string;
}

export interface HostPickScenarioPayload {
  scenarioId: string | 'RANDOM';
}

export interface HostSkipVotePayload {
  disconnectedPlayerId: string;
}

export interface RevealSubmitPayload {
  categories: TraitCategory[]; // must match round quota exactly
}

export interface VoteSubmitPayload {
  targetId: string;
}

// ─── Acknowledgement types (discriminated unions) ────────────────────────────────

export type RoomJoinAck =
  | { ok: true; player: PlayerView; room: RoomView; reconnectToken: string }
  | { ok: false; error: RoomJoinError };

export type HostKickAck = { ok: true } | { ok: false; error: HostKickError };
export type HostStartGameAck = { ok: true } | { ok: false; error: HostStartGameError };
export type HostPickScenarioAck = { ok: true } | { ok: false; error: HostPickScenarioError };
export type HostExtendTimerAck = { ok: true; newRemaining: number } | { ok: false; error: HostExtendTimerError };
export type HostForceVoteAck = { ok: true } | { ok: false; error: HostForceVoteError };
export type HostEndGameAck = { ok: true } | { ok: false; error: HostEndGameError };
export type HostPlayAgainAck = { ok: true } | { ok: false; error: HostPlayAgainError };
export type HostEndSessionAck = { ok: true } | { ok: false; error: HostEndSessionError };
export type HostSkipVoteAck = { ok: true } | { ok: false; error: HostSkipVoteError };
export type RevealSubmitAck = { ok: true } | { ok: false; error: RevealSubmitError };
export type VoteSubmitAck = { ok: true } | { ok: false; error: VoteSubmitError };

// ─── Server → Client payloads ─────────────────────────────────────────────────

/** Full current state — sent on initial join or after reconnect */
export interface RoomStatePayload {
  room: RoomView;
  players: PlayerView[];
  ownCharacter: CharacterCard | null; // null in lobby before game starts
  game: GameView | null; // null in lobby
}

export interface PlayerJoinedPayload {
  player: PlayerView;
}

export interface PlayerLeftPayload {
  playerId: string;
  newHostId: string | null; // set if host transferred
}

export interface PlayerReconnectingPayload {
  playerId: string;
}

export interface PlayerReconnectedPayload {
  playerId: string;
}

export interface PlayerKickedPayload {
  message: string; // "Вас видалено з кімнати"
}

export interface HostTransferredPayload {
  newHostId: string;
  reason: 'DISCONNECT_TIMEOUT' | 'ORIGINAL_RECONNECTED';
}

export interface HostDisconnectedVoterPromptPayload {
  disconnectedPlayerId: string;
  disconnectedNickname: string;
}

/** The most important server event — triggers client re-render for the new phase */
export interface PhaseChangedPayload {
  state: RoomState;
  round: 1 | 2 | 3 | null;
  phase: 'REVEAL' | 'DEBATE' | 'VOTE' | null;
  revealQuota: number | null; // 2, 2, or 1 depending on round
  timerSeconds: number | null; // set for DEBATE phase
}

export interface ScenariosListPayload {
  scenarios: Scenario[];
}

/** Sent after host picks a scenario — each player gets their own card only */
export interface GameStartedPayload {
  scenario: Scenario;
  ownCharacter: CharacterCard;
  players: PlayerView[];
}

/** Broadcast immediately when any player submits reveals (rolling reveal) */
export interface RevealUpdatePayload {
  playerId: string;
  revealedTraits: TraitSlot[];
  waitingFor: number; // 0 means all submitted → phase advances
}

export interface TimerTickPayload {
  remaining: number; // seconds remaining
}

export interface TimerExtendedPayload {
  newRemaining: number;
}

/** Broadcast immediately when any player votes (open vote) */
export interface VoteUpdatePayload {
  voterId: string;
  targetId: string;
  tally: Record<string, number>; // targetId → vote count
}

export interface VoteTiebreakerPayload {
  tiedPlayerIds: string[];
  isHostDeciding: boolean; // true when re-vote also tied and only host votes
  decidingPlayerId: string | null; // the player who casts the host tiebreaker vote
}

export interface PlayerEliminatedPayload {
  playerId: string;
  eliminatedInRound: 1 | 2 | 3;
  fullCharacter: CharacterCard; // all traits revealed
  reason: 'VOTE' | 'AUTO_TIMEOUT';
}

export interface GameEndedPayload {
  reason: 'COMPLETED' | 'HOST_ENDED_EARLY';
  survivors: PlayerView[]; // with full character cards
  eliminated: PlayerView[]; // in elimination order, with full cards
  outcomeSummary: string; // Ukrainian template text
}

export interface RoomClosedPayload {
  message: string; // "Дякуємо за гру"
}

// ─── HTTP API types ──────────────────────────────────────────────────────────────

export interface CreateRoomRequest {
  nickname: string;
}

export interface CreateRoomResponse {
  roomId: string;
  roomCode: string;
  roomUrl: string;
  playerId: string;
  sessionToken: string;
  reconnectToken: string;
}

export interface HealthResponse {
  status: 'ok';
  uptime: number;
  activeRooms: number;
}
