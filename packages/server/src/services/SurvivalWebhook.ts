import type { Server } from 'socket.io';
import { EVENTS } from '@bunker/shared';
import type { Player, Scenario, SurvivalPredictionPayload } from '@bunker/shared';

const SURVIVAL_WEBHOOK_URL = 'https://primary-production-dd401.up.railway.app/webhook/bunker';

export async function callSurvivalWebhook(
  roomId: string,
  scenario: Scenario,
  survivors: Player[],
  ioServer: Server,
): Promise<void> {
  try {
    const body = {
      scenarioTitle: scenario.title,
      scenarioDescription: scenario.description,
      bunkerYears: scenario.bunkerConditions.supplyDuration,
      survivors: survivors.map((p) => ({
        nickname: p.nickname,
        traits: Object.fromEntries(
          Object.entries(p.character?.traits ?? {}).map(([cat, slot]) => [cat, (slot as { value: string }).value]),
        ),
      })),
    };

    const res = await fetch(SURVIVAL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();
    let prediction = text;
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      prediction = String(json.prediction ?? json.message ?? json.response ?? json.text ?? json.content ?? text);
    } catch {
      // use raw text
    }

    const predPayload: SurvivalPredictionPayload = { prediction };
    ioServer.to(roomId).emit(EVENTS.SURVIVAL_PREDICTION, predPayload);
  } catch (err) {
    console.error('[webhook] survival prediction failed:', err);
  }
}
