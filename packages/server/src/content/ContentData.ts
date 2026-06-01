/**
 * ContentData — loads and caches all static game content at startup.
 * Reads JSON files from the content/ directory relative to the server.
 * Never mutated after initialization — all accessors return read-only slices.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Trait, Scenario, TraitCategory } from '@bunker/shared';
import { TRAIT_CATEGORIES } from '@bunker/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the content directory — works both in development (src/) and production (dist/)
// Content files are always at <repo-root>/content/, so we navigate up from dist/content/
const CONTENT_DIR = resolve(__dirname, '../../../../content');

function loadJson<T>(filePath: string): T {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`Failed to load content file: ${filePath} — ${String(err)}`);
  }
}

const TRAIT_FILE_MAP: Record<TraitCategory, string> = {
  GENDER_AGE: 'gender_age.json',
  PROFESSION: 'profession.json',
  HEALTH: 'health.json',
  HOBBY: 'hobby.json',
  PHOBIA: 'phobia.json',
  BAGGAGE: 'baggage.json',
  SECRET_FACT: 'secret_fact.json',
};

export class ContentData {
  private readonly traitsByCategory: Readonly<Record<TraitCategory, readonly Trait[]>>;
  readonly scenarios: readonly Scenario[];

  constructor(contentDir: string = CONTENT_DIR) {
    // Load all trait files
    const traitMap = {} as Record<TraitCategory, Trait[]>;
    for (const category of TRAIT_CATEGORIES) {
      const filename = TRAIT_FILE_MAP[category];
      const filePath = resolve(contentDir, 'traits', filename);
      traitMap[category] = loadJson<Trait[]>(filePath);
    }
    this.traitsByCategory = traitMap;

    // Load scenarios
    this.scenarios = loadJson<Scenario[]>(resolve(contentDir, 'scenarios', 'scenarios.json'));

    this.validate();
  }

  /** Returns all traits for the given category */
  getTraitsByCategory(category: TraitCategory): readonly Trait[] {
    const traits = this.traitsByCategory[category];
    return traits;
  }

  /** Returns the minimum pool size across all categories (used to check max players) */
  getMinCategorySize(): number {
    return Math.min(
      ...TRAIT_CATEGORIES.map((cat) => this.traitsByCategory[cat].length),
    );
  }

  /** Returns a scenario by ID or undefined if not found */
  getScenario(scenarioId: string): Scenario | undefined {
    return this.scenarios.find((s) => s.id === scenarioId);
  }

  /** Returns all non-premium scenarios (all in MVP since isPremium is always false) */
  getAvailableScenarios(): readonly Scenario[] {
    return this.scenarios.filter((s) => !s.isPremium);
  }

  /** Validates content integrity at startup — throws if data is malformed */
  private validate(): void {
    for (const category of TRAIT_CATEGORIES) {
      const traits = this.traitsByCategory[category];
      if (!traits || traits.length === 0) {
        throw new Error(`No traits found for category: ${category}`);
      }
      // Verify all trait IDs are unique within category
      const ids = new Set(traits.map((t) => t.id));
      if (ids.size !== traits.length) {
        throw new Error(`Duplicate trait IDs found in category: ${category}`);
      }
    }

    if (this.scenarios.length === 0) {
      throw new Error('No scenarios found in scenarios.json');
    }
  }
}
