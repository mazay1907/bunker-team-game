/**
 * Core domain models for Bunker Team Game.
 * These are the authoritative in-memory shapes used by the server.
 * The *View types are safe client-facing projections that enforce visibility rules.
 */

// ─── Enumerations ──────────────────────────────────────────────────────────────

export type RoomState =
  | 'LOBBY'
  | 'SCENARIO_PICK'
  | 'R1_REVEAL'
  | 'R1_DEBATE'
  | 'R1_VOTE'
  | 'R2_REVEAL'
  | 'R2_DEBATE'
  | 'R2_VOTE'
  | 'R3_REVEAL'
  | 'R3_DEBATE'
  | 'R3_VOTE'
  | 'ENDED';

export type PlayerStatus = 'ACTIVE' | 'RECONNECTING' | 'SPECTATOR' | 'KICKED';

/**
 * The 7 trait categories every character has.
 * Values map to Ukrainian display labels in uk.json.
 */
export type TraitCategory =
  | 'GENDER_AGE' // Стать / вік
  | 'PROFESSION' // Професія
  | 'HEALTH' // Здоров'я
  | 'HOBBY' // Хобі
  | 'PHOBIA' // Фобія
  | 'BAGGAGE' // Багаж
  | 'SECRET_FACT'; // Факт

export const TRAIT_CATEGORIES: TraitCategory[] = [
  'GENDER_AGE',
  'PROFESSION',
  'HEALTH',
  'HOBBY',
  'PHOBIA',
  'BAGGAGE',
  'SECRET_FACT',
];

// ─── Content types (loaded from JSON at startup) ────────────────────────────────

export interface Trait {
  id: string; // e.g. "prof-surgeon"
  category: TraitCategory;
  value: string; // Ukrainian display string
}

export interface BunkerConditions {
  capacity: number; // bunker size in people
  supplyDuration: string; // e.g. "2 роки"
  outsideEnvironment: string; // e.g. "радіоактивна пустеля"
}

export interface Scenario {
  id: string; // slug, e.g. "nuclear-war"
  title: string; // Ukrainian
  description: string; // Ukrainian narrative, 2-4 sentences
  bunkerConditions: BunkerConditions;
  isPremium: boolean; // always false in MVP; Phase 2 filter
}

// ─── Character card ─────────────────────────────────────────────────────────────

export interface TraitSlot {
  category: TraitCategory;
  traitId: string; // references a trait entry in the content JSON
  value: string; // denormalized display string (Ukrainian)
  isRevealed: boolean; // false until player reveals or is eliminated
}

export interface CharacterCard {
  playerId: string;
  traits: Record<TraitCategory, TraitSlot>; // exactly 7 entries, one per category
}

// ─── Round and vote records ──────────────────────────────────────────────────────

export interface RevealSubmission {
  playerId: string;
  revealedCategories: TraitCategory[];
  submittedAt: Date;
}

export interface VoteRecord {
  voterId: string;
  targetId: string;
  submittedAt: Date;
  isAbstention: boolean; // true when host skipped a disconnected voter
}

export interface Round {
  roundNumber: 1 | 2 | 3;
  revealQuota: 2 | 1; // reveals required per player in this round (R1=2, R2=2, R3=1)
  revealSubmissions: Map<string, RevealSubmission>; // keyed by playerId
  votes: Map<string, VoteRecord>; // keyed by voterId
  tiebreakVotes: Map<string, VoteRecord> | null; // populated on first tie
  eliminatedPlayerId: string | null;
  autoEliminationTriggered: boolean; // true if disconnect timeout caused elimination
}

// ─── Game ───────────────────────────────────────────────────────────────────────

export interface Game {
  roomId: string;
  scenarioId: string;
  rounds: [Round, Round, Round]; // exactly 3 rounds, pre-allocated
  startedAt: Date;
  endedAt: Date | null;
  endReason: 'COMPLETED' | 'HOST_ENDED_EARLY' | null;
}

// ─── Player ─────────────────────────────────────────────────────────────────────

export interface Player {
  playerId: string; // UUID v4
  roomId: string; // back-reference to the containing room
  nickname: string; // 2-20 characters, unique within room (suffixed if collision)
  sessionToken: string; // 64-char hex stored in client localStorage for reconnect identity
  reconnectToken: string; // separate 64-char hex issued at join; restores room slot after drop
  socketId: string | null; // current Socket.IO socket ID; null when disconnected
  status: PlayerStatus;
  joinedAt: Date; // used for longest-connected tiebreaker logic
  disconnectedAt: Date | null; // set when socket drops; cleared on reconnect
  eliminatedInRound: 1 | 2 | 3 | null; // null if still active
  character: CharacterCard | null; // null until game starts
  revealHistory: RevealSubmission[]; // all reveal submissions across all rounds
}

// ─── Room ───────────────────────────────────────────────────────────────────────

export interface Room {
  roomId: string; // UUID v4
  roomCode: string; // 6-char uppercase alphanumeric, e.g. "BNK7R2"
  hostPlayerId: string; // player.playerId of current host (changes on transfer)
  state: RoomState;
  currentRound: 1 | 2 | 3 | null; // null when LOBBY/SCENARIO_PICK/ENDED
  currentPhase: 'REVEAL' | 'DEBATE' | 'VOTE' | null;
  scenarioId: string | null; // null until scenario picked
  players: Map<string, Player>; // keyed by playerId
  game: Game | null; // null until game starts
  createdAt: Date;
  lastActivityAt: Date;
  hostUserId: string | null; // nullable — Phase 2 FK to user account
}

// ─── View types (safe client-facing projections) ────────────────────────────────

/**
 * The player view sent to clients.
 * visibleTraits contains only revealed traits for opponents;
 * full card only for the player themselves or when eliminated.
 */
export interface PlayerView {
  playerId: string;
  nickname: string;
  status: PlayerStatus;
  isHost: boolean;
  eliminatedInRound: 1 | 2 | 3 | null;
  visibleTraits: TraitSlot[]; // only revealed traits; full card if self or eliminated
}

export interface RoomView {
  roomCode: string;
  state: RoomState;
  currentRound: 1 | 2 | 3 | null;
  currentPhase: 'REVEAL' | 'DEBATE' | 'VOTE' | null;
  scenario: Scenario | null;
  playerCount: number;
}

export interface GameView {
  round: 1 | 2 | 3;
  phase: 'REVEAL' | 'DEBATE' | 'VOTE';
  revealQuota: number;
  debateTimerRemaining: number | null;
  votes: VoteRecord[];
}

// ─── Game constants ──────────────────────────────────────────────────────────────

export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = 10;
export const TOTAL_ROUNDS = 3;
export const REVEAL_QUOTAS: Record<1 | 2 | 3, 2 | 1> = { 1: 2, 2: 2, 3: 1 };
export const DEBATE_TIMER_SECONDS = 300; // 5 minutes
export const REVEAL_TIMEOUT_SECONDS = 120; // 2 minutes — auto-selects unrevealed traits
export const RECONNECT_HOLD_SECONDS = 300; // 5 minutes
export const HOST_TRANSFER_SECONDS = 60; // 1 minute
export const ROOM_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O, I, 0, 1
export const ROOM_CODE_LENGTH = 6;
