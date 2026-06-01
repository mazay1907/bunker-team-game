/**
 * SessionStore — maps sessionToken → playerId.
 * Used to identify returning players by their device token.
 * Phase 2: replace with Redis implementation for multi-instance support.
 */

export interface ISessionStore {
  set(sessionToken: string, playerId: string): void;
  get(sessionToken: string): string | undefined;
  delete(sessionToken: string): void;
}

export class InMemorySessionStore implements ISessionStore {
  private readonly sessions = new Map<string, string>();

  set(sessionToken: string, playerId: string): void {
    this.sessions.set(sessionToken, playerId);
  }

  get(sessionToken: string): string | undefined {
    return this.sessions.get(sessionToken);
  }

  delete(sessionToken: string): void {
    this.sessions.delete(sessionToken);
  }
}
