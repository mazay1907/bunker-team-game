/**
 * Zustand store — single source of truth for all client game state.
 *
 * Socket event handlers call store setters directly (outside React render cycle).
 * Components read from the store via Zustand selectors — not via props or context.
 *
 * WHY Zustand (not useReducer + Context):
 * Socket.IO events fire outside React's render cycle. Zustand's store can be
 * updated from socket listeners without causing full-tree re-renders.
 * A context dispatch chain would re-render everything on every socket event.
 */

import { create } from 'zustand';
import type { RoomView, PlayerView, CharacterCard, GameView } from '@bunker/shared';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

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

  // Error state
  lastError: string | null;

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
  reset: () => void;
}

const initialState = {
  connectionState: 'disconnected' as ConnectionState,
  room: null,
  players: [],
  ownCharacter: null,
  game: null,
  ownPlayerId: null,
  ownNickname: null,
  lastError: null,
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

  reset: () => set(initialState),
}));
