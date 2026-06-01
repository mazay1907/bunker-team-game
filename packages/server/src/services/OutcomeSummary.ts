/**
 * OutcomeSummary — generates the Ukrainian outcome summary text for the game end screen.
 *
 * Template-based (no AI required per BACKLOG 8.1.2).
 * Mentions survivors by profession and/or other traits for flavour.
 */

import type { Player } from '@bunker/shared';

/**
 * Builds the outcome summary string shown on the game end screen.
 * Uses survivors' professions when available for a more interesting summary.
 *
 * reason: 'COMPLETED' | 'HOST_ENDED_EARLY'
 */
export function buildOutcomeSummary(
  survivors: Player[],
  eliminated: Player[],
  reason: 'COMPLETED' | 'HOST_ENDED_EARLY',
): string {
  if (reason === 'HOST_ENDED_EARLY') {
    return 'Гру завершено достроково.';
  }

  if (survivors.length === 0) {
    return 'Ніхто не потрапив до бункера. Людство не вижило.';
  }

  const survivorDescriptions = survivors.map((p) => describeSurvivor(p));
  const survivorList = survivorDescriptions.join(', ');
  const count = survivors.length;

  const bunkerText = `У бункері залишились ${count} ${pluralPeople(count)}: ${survivorList}.`;

  if (eliminated.length === 0) return bunkerText;

  const eliminatedNames = eliminated.map((p) => p.nickname).join(', ');
  const excludedText = `Виключено: ${eliminatedNames}.`;

  return `${bunkerText} ${excludedText}`;
}

/**
 * Returns a short description of a survivor for the summary.
 * Uses profession trait when revealed; falls back to nickname.
 */
function describeSurvivor(player: Player): string {
  const professionSlot = player.character?.traits['PROFESSION'];
  if (professionSlot?.value) {
    return `${player.nickname} (${professionSlot.value})`;
  }
  return player.nickname;
}

/**
 * Ukrainian plural form for "людина/людини/людей".
 */
function pluralPeople(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'людей';
  if (mod10 === 1) return 'людина';
  if (mod10 >= 2 && mod10 <= 4) return 'людини';
  return 'людей';
}
