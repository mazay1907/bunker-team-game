/**
 * RoomStore — interface and in-memory implementation.
 *
 * All game state access goes through this interface.
 * The in-memory implementation uses a plain Map.
 * Phase 2: swap implementation for Redis without touching game logic.
 */

import type { Room } from '@bunker/shared';

export interface IRoomStore {
  createRoom(room: Room): void;
  getRoom(roomId: string): Room | undefined;
  getRoomByCode(code: string): Room | undefined;
  /**
   * Atomically applies an updater function to the room and stores the result.
   * The updater receives the current room and must return the updated room.
   * Does nothing if the room doesn't exist.
   */
  updateRoom(roomId: string, updater: (r: Room) => Room): void;
  deleteRoom(roomId: string): void;
  getAllRooms(): Room[];
}

export class InMemoryRoomStore implements IRoomStore {
  private readonly rooms = new Map<string, Room>();

  createRoom(room: Room): void {
    this.rooms.set(room.roomId, room);
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getRoomByCode(code: string): Room | undefined {
    // Linear scan — acceptable at MVP scale (< 100 rooms)
    for (const room of this.rooms.values()) {
      if (room.roomCode === code) {
        return room;
      }
    }
    return undefined;
  }

  updateRoom(roomId: string, updater: (r: Room) => Room): void {
    const existing = this.rooms.get(roomId);
    if (!existing) return;
    const updated = updater(existing);
    this.rooms.set(roomId, updated);
  }

  deleteRoom(roomId: string): void {
    this.rooms.delete(roomId);
  }

  getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }
}
