import { describe, expect, it } from 'vitest';
import { parseAppearance, updateAppearance } from './use-appearance';

describe('appearance font', () => {
  it('starts on Roboto and keeps a saved Inter or System choice', () => {
    expect(parseAppearance(null).font).toBe('roboto');
    expect(parseAppearance('{').font).toBe('roboto');
    expect(parseAppearance('{"font":"unknown"}').font).toBe('roboto');
    expect(parseAppearance('{"font":"inter"}').font).toBe('inter');
    expect(parseAppearance('{"font":"system"}').font).toBe('system');
  });
  it('puts the chosen bundled family first in the interface font stack', () => {
    const stack = () => document.documentElement.style.getPropertyValue('--font-sans');
    updateAppearance({ font: 'roboto' });
    expect(stack()).toMatch(/^"Roboto Variable", /);
    updateAppearance({ font: 'inter' });
    expect(stack()).toMatch(/^"Inter Variable", /);
    updateAppearance({ font: 'system' });
    expect(stack()).toMatch(/^-apple-system, /);
    updateAppearance({ font: 'roboto' });
  });
});
