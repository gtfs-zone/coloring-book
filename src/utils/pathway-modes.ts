import { t } from '../i18n/messages';

/**
 * Single source of truth for how pathway modes are named and drawn.
 *
 * Hue encodes the category (what kind of transition it is) rather than the
 * exact mode, and the dash pattern is redundant with the hue. The exact mode
 * is carried by the icon drawn at the center of each line, which is why seven
 * competing hues are not needed.
 */

export type PathwayCategory = 'horizontal' | 'vertical' | 'access';

export interface PathwayCategoryStyle {
  label: string;
  color: string;
  /** null renders a solid line. */
  dash: number[] | null;
}

export const PATHWAY_CATEGORY_ORDER: PathwayCategory[] = [
  'horizontal',
  'vertical',
  'access',
];

export const PATHWAY_CATEGORIES: Record<PathwayCategory, PathwayCategoryStyle> =
  {
    horizontal: {
      label: t('pathway.horizontal'),
      color: '#94a3b8',
      dash: null,
    },
    vertical: {
      label: t('pathway.vertical'),
      color: '#5eaea8',
      dash: [2, 1.6],
    },
    access: {
      label: t('pathway.access'),
      color: '#d6a15c',
      dash: [3, 1.1, 0.5, 1.1],
    },
  };

export interface PathwayModeInfo {
  label: string;
  category: PathwayCategory;
  /** Image name registered by ensureMapIcons in map-icons.ts. */
  icon: string;
}

export const PATHWAY_MODES: Record<number, PathwayModeInfo> = {
  1: {
    label: t('pathway.walkway'),
    category: 'horizontal',
    icon: 'pathway-walk',
  },
  2: {
    label: t('pathway.stairs'),
    category: 'vertical',
    icon: 'pathway-stairs',
  },
  3: {
    label: t('pathway.movingSidewalk'),
    category: 'horizontal',
    icon: 'pathway-sidewalk',
  },
  4: {
    label: t('pathway.escalator'),
    category: 'vertical',
    icon: 'pathway-escalator',
  },
  5: {
    label: t('pathway.elevator'),
    category: 'vertical',
    icon: 'pathway-elevator',
  },
  6: { label: t('pathway.fareGate'), category: 'access', icon: 'pathway-gate' },
  7: { label: t('pathway.exitGate'), category: 'access', icon: 'pathway-exit' },
};

export function pathwayModeLabel(mode: number): string {
  return (
    PATHWAY_MODES[mode]?.label ?? t('pathway.mode', { mode: String(mode) })
  );
}

export function modesInCategory(category: PathwayCategory): number[] {
  return Object.keys(PATHWAY_MODES)
    .map(Number)
    .filter((mode) => PATHWAY_MODES[mode].category === category);
}
