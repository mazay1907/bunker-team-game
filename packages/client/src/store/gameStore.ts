/**
 * Zustand store — single source of truth for all client game state.
 *
 * Socket event handlers call store setters directly (outside React render cycle).
 * Components read from the store via Zustand selectors — not via props or context.
 *
 * WHY Zustand (not useReducer + Context):
 * Socket.IO events fire outside React's render cycle. Zustand's store can be
 * updated from socket listeners without causing full-tree re-renders.
 */

import { create } from 'zustand';
import type {
  RoomView,
  PlayerView,
  CharacterCard,
  GameView,
  Scenario,
  VoteRecord,
} from '@bunker/shared';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

interface TiebreakerState {
  tiedPlayerIds: string[];
  isHostDeciding: boolean;
  decidingPlayerId: string | null;
}

interface DisconnectedVoterPromptState {
  disconnectedPlayerId: string;
  disconnectedNickname: string;
}

interface GameState {
  // Connection
  connectionState: ConnectionState;

  // Room state — mirrors last-known server state
  room: RoomView | null;
  players: PlayerView[];
  ownCharacter: CharacterCard | null;
  game: GameView | null;

  // Own player identity
  ownPlayerId: string | null;
  ownNickname: string | null;

  // Scenario picker
  availableScenarios: Scenario[];

  // Vote state
  votes: VoteRecord[];
  voteTally: Record<string, number>;
  tiebreaker: TiebreakerState | null;
  disconnectedVoterPrompt: DisconnectedVoterPromptState | null;

  // Timer
  debateTimer: number | null;

  // UI state
  lastError: string | null;
  isRevealed: boolean; // has own player submitted reveal this round

  // Game-end state
  gameEnded: {
    reason: 'COMPLETED' | 'HOST_ENDED_EARLY';
    survivors: PlayerView[];
    eliminated: PlayerView[];
    outcomeSummary: string;
  } | null;

  // Actions — called by socket event handlers
  setConnectionState: (state: ConnectionState) => void;
  setRoom: (room: RoomView | null) => void;
  setPlayers: (players: PlayerView[]) => void;
  setOwnCharacter: (character: CharacterCard | null) => void;
  setGame: (game: GameView | null) => void;
  setOwnPlayer: (playerId: string, nickname: string) => void;
  updatePlayer: (updated: PlayerView) => void;
  removePlayer: (playerId: string) => void;
  setLastError: (error: string | null) => void;
  setAvailableScenarios: (scenarios: Scenario[]) => void;
  addVote: (vote: VoteRecord) => void;
  setVoteTally: (tally: Record<string, number>) => void;
  setTiebreaker: (state: TiebreakerState | null) => void;
  setDisconnectedVoterPrompt: (state: DisconnectedVoterPromptState | null) => void;
  setDebateTimer: (remaining: number | null) => void;
  setIsRevealed: (val: boolean) => void;
  setGameEnded: (payload: GameState['gameEnded']) => void;
  reset: () => void;
  resetRound: () => void;
}

const initialState = {
  connectionState: 'disconnected' as ConnectionState,
  room: null,
  players: [],
  ownCharacter: null,
  game: null,
  ownPlayerId: null,
  ownNickname: null,
  availableScenarios: [],
  votes: [],
  voteTally: {},
  tiebreaker: null,
  disconnectedVoterPrompt: null,
  debateTimer: null,
  lastError: null,
  isRevealed: false,
  gameEnded: null,
};

export const useGameStore = create<GameState>((set) => ({
  ...initialState,

  setConnectionState: (connectionState) => set({ connectionState }),

  setRoom: (room) => set({ room }),

  setPlayers: (players) => set({ players }),

  setOwnCharacter: (ownCharacter) => set({ ownCharacter }),

  setGame: (game) => set({ game }),

  setOwnPlayer: (playerId, nickname) =>
    set({ ownPlayerId: playerId, ownNickname: nickname }),

  updatePlayer: (updated) =>
    set((state) => ({
      players: state.players.map((p) =>
        p.playerId === updated.playerId ? updated : p,
      ),
    })),

  removePlayer: (playerId) =>
    set((state) => ({
      players: state.players.filter((p) => p.playerId !== playerId),
    })),

  setLastError: (lastError) => set({ lastError }),

  setAvailableScenarios: (availableScenarios) => set({ availableScenarios }),

  addVote: (vote) =>
    set((state) => {
      // Replace existing vote from same voter if any
      const filtered = state.votes.filter((v) => v.voterId !== vote.voterId);
      return { votes: [...filtered, vote] };
    }),

  setVoteTally: (voteTally) => set({ voteTally }),

  setTiebreaker: (tiebreaker) => set({ tiebreaker }),

  setDisconnectedVoterPrompt: (disconnectedVoterPrompt) => set({ disconnectedVoterPrompt }),

  setDebateTimer: (debateTimer) => set({ debateTimer }),

  setIsRevealed: (isRevealed) => set({ isRevealed }),

  setGameEnded: (gameEnded) => set({ gameEnded }),

  resetRound: () =>
    set({ votes: [], voteTally: {}, tiebreaker: null, disconnectedVoterPrompt: null, isRevealed: false }),

  reset: () => set(initialState),
}));
