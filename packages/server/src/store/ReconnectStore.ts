/**
 * ReconnectStore — maps reconnectToken → playerId.
 * A second independent token issued at join time.
 * Required alongside sessionToken to restore a room slot after a mid-game disconnect.
 * Keeping them separate means a sessionToken compromise does not allow room-slot takeover.
 */

export interface IReconnectStore {
  set(reconnectToken: string, playerId: string): void;
  get(reconnectToken: string): string | undefined;
  delete(reconnectToken: string): void;
}

export class InMemoryReconnectStore implements IReconnectStore {
  private readonly index = new Map<string, string>();

  set(reconnectToken: string, playerId: string): void {
    this.index.set(reconnectToken, playerId);
  }

  get(reconnectToken: string): string | undefined {
    return this.index.get(reconnectToken);
  }

  delete(reconnectToken: string): void {
    this.index.delete(reconnectToken);
  }
}
