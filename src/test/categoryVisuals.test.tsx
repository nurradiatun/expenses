import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_COLOR_PALETTE,
  CATEGORY_ICON_OPTIONS,
  CategoryBadgeIcon,
  resolveCategoryAppearance,
} from '../lib/categoryVisuals';
import type { CustomCategory } from '../types';

describe('Category Icons & Colors', () => {
  it('provides curated icon options and hex color swatches', () => {
    expect(CATEGORY_ICON_OPTIONS.length).toBeGreaterThanOrEqual(24);
    expect(CATEGORY_COLOR_PALETTE.length).toBeGreaterThanOrEqual(12);
    for (const swatch of CATEGORY_COLOR_PALETTE) {
      expect(swatch.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('resolves user-customized icon and color overrides over built-in defaults', () => {
    const defaults = resolveCategoryAppearance('Makan & Minum', [], 'expense');
    expect(defaults.iconKey).toBe('Utensils');
    expect(defaults.hasCustomVisual).toBe(false);

    const customDocs: CustomCategory[] = [
      {
        id: 'cat-custom',
        ownerId: 'u1',
        name: 'Makan & Minum',
        categoryType: 'expense',
        icon: 'Coffee',
        color: '#7C3AED',
      },
    ];

    const customized = resolveCategoryAppearance('Makan & Minum', customDocs, 'expense');
    expect(customized.iconKey).toBe('Coffee');
    expect(customized.color).toBe('#7C3AED');
    expect(customized.hasCustomVisual).toBe(true);
  });

  it('renders CategoryBadgeIcon with the resolved category color styling', () => {
    const { container } = render(
      <CategoryBadgeIcon
        categoryName="Gaji"
        iconOverride="Briefcase"
        colorOverride="#059669"
        size="md"
      />
    );
    const badge = container.querySelector('span');
    expect(badge).not.toBeNull();
    expect(badge?.style.color).toBe('rgb(5, 150, 105)');
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
