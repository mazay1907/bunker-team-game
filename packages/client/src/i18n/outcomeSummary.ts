/**
 * Composes the end-of-game outcome sentence from structured server data.
 *
 * The server (packages/server/src/services/OutcomeSummary.ts) sends only facts
 * — survivor nicknames/professions, eliminated nicknames, and the end reason.
 * All Ukrainian phrasing lives here and in uk.json, per CLAUDE.md's i18n rule.
 */

import type { OutcomeSummaryData } from '@bunker/shared';
import { t } from './t.js';

/**
 * Ukrainian plural form key for "людина/людини/людей" counts.
 * Mirrors the standard Slavic plural rule: 1 -> one, 2-4 -> few, else -> many
 * (with the 11-14 exception, which always takes the "many" form).
 */
function survivorsCountKey(n: number): 'end.summary.survivorsOne' | 'end.summary.survivorsFew' | 'end.summary.survivorsMany' {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'end.summary.survivorsMany';
  if (mod10 === 1) return 'end.summary.survivorsOne';
  if (mod10 >= 2 && mod10 <= 4) return 'end.summary.survivorsFew';
  return 'end.summary.survivorsMany';
}

/** Formats one survivor as "Nickname (Profession)" or just "Nickname". */
function describeSurvivor(survivor: OutcomeSummaryData['survivors'][number]): string {
  return survivor.profession ? `${survivor.nickname} (${survivor.profession})` : survivor.nickname;
}

/**
 * Builds the final Ukrainian summary sentence for the game-end screen.
 * Returns just the early-end line when the host ended the game manually.
 */
export function composeOutcomeSummary(data: OutcomeSummaryData): string {
  if (data.reason === 'HOST_ENDED_EARLY') {
    return t('end.summary.earlyEnd');
  }

  if (data.survivors.length === 0) {
    return t('end.summary.noSurvivors');
  }

  const list = data.survivors.map(describeSurvivor).join(', ');
  const bunkerText = t(survivorsCountKey(data.survivors.length), {
    count: data.survivors.length,
    list,
  });

  if (data.eliminatedNicknames.length === 0) return bunkerText;

  const excludedText = t('end.summary.excluded', { list: data.eliminatedNicknames.join(', ') });
  return `${bunkerText} ${excludedText}`;
}
