/**
 * Basic analytics event emission.
 * Emits non-PII structured events to console.log for debugging early plays.
 * No external service — in-memory log only.
 * Per BACKLOG 1.3.3: room_created, game_started, game_completed, player_joined.
 */

type AnalyticsEvent =
  | { type: 'room_created'; roomCode: string; timestamp: string }
  | { type: 'player_joined'; roomCode: string; playerCount: number; timestamp: string }
  | { type: 'game_started'; roomCode: string; scenarioId: string; playerCount: number; timestamp: string }
  | { type: 'game_completed'; roomCode: string; reason: 'COMPLETED' | 'HOST_ENDED_EARLY'; survivorCount: number; timestamp: string };

/**
 * Emits a structured analytics event to stdout.
 * WHY console.log: MVP has no analytics sink; structured JSON enables
 * easy ingestion into any log aggregator later without code changes.
 */
export function emitAnalytics(event: AnalyticsEvent): void {
  console.log('[analytics]', JSON.stringify(event));
}
