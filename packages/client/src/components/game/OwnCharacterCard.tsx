/**
 * OwnCharacterCard — shows the player's full 7-trait character card.
 * Revealed traits are visually distinguished. In REVEAL phase, allows selection.
 */

import type { CharacterCard, TraitCategory } from '@bunker/shared';
import { TRAIT_CATEGORIES } from '@bunker/shared';
import { t } from '../../i18n/t.js';

const TRAIT_EMOJI: Record<TraitCategory, string> = {
  GENDER_AGE: '👤',
  PROFESSION: '💼',
  HEALTH: '❤️',
  HOBBY: '🎯',
  PHOBIA: '😱',
  BAGGAGE: '🎒',
  SECRET_FACT: '🔍',
};

interface OwnCharacterCardProps {
  character: CharacterCard;
  /** Categories selectable in reveal phase (undefined = not in reveal phase) */
  selectableCategories?: TraitCategory[];
  selectedCategories?: TraitCategory[];
  onToggle?: (cat: TraitCategory) => void;
}

export function OwnCharacterCard({
  character,
  selectableCategories,
  selectedCategories = [],
  onToggle,
}: OwnCharacterCardProps): JSX.Element {
  const isRevealPhase = selectableCategories !== undefined;

  return (
    <div className="bg-bunker-surface border border-bunker-border rounded p-4">
      <h3 className="font-oswald font-bold text-sm text-bunker-muted uppercase tracking-wider mb-3">
        {t('game.card.ownCard')}
      </h3>
      <div className="grid grid-cols-1 gap-2">
        {TRAIT_CATEGORIES.map((cat) => {
          const slot = character.traits[cat];
          const isAlreadyRevealed = slot.isRevealed;
          const isSelected = selectedCategories.includes(cat);
          const isSelectable = isRevealPhase &&
            selectableCategories?.includes(cat) &&
            !isAlreadyRevealed;

          return (
            <button
              key={cat}
              disabled={!isSelectable}
              onClick={() => isSelectable && onToggle?.(cat)}
              className={[
                'flex items-center gap-3 p-3 rounded border text-left transition-all duration-150',
                isSelected
                  ? 'border-bunker-hot bg-bunker-hot/15 text-bunker-text'
                  : isAlreadyRevealed
                    ? 'border-bunker-success/30 bg-bunker-success/5 cursor-default'
                    : isSelectable
                      ? 'border-bunker-border hover:border-bunker-hot/50 hover:bg-bunker-surface cursor-pointer'
                      : 'border-bunker-border/30 cursor-default opacity-60',
              ].join(' ')}
            >
              <span className="text-lg shrink-0">{TRAIT_EMOJI[cat]}</span>
              <div className="flex-1 min-w-0">
                <p className="font-inter text-xs text-bunker-muted uppercase tracking-[0.06em]">
                  {t(`trait.category.${cat}` as Parameters<typeof t>[0])}
                </p>
                <p className="font-inter text-sm text-bunker-text mt-0.5 truncate">
                  {slot.value}
                </p>
              </div>
              {isAlreadyRevealed && (
                <span className="font-mono text-xs text-bunker-success/70 shrink-0">
                  {t('game.card.revealed')}
                </span>
              )}
              {isSelected && !isAlreadyRevealed && (
                <span className="text-bunker-hot font-bold text-base shrink-0">✓</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
