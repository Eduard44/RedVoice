import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES, THEME_COLOR_ROLES } from './t3-palettes';
import {
  AVAILABLE_PALETTES,
  colorVariable,
  paletteColors,
  parseThemePreferences,
  resolveTheme,
} from './theme-preferences';

describe('theme preferences', () => {
  it('preserves the old appearance and tolerates malformed saved preferences', () => {
    expect(parseThemePreferences('{', 'light')).toEqual({
      mode: 'light',
      light: 'default',
      dark: 'redvoice',
    });
    expect(parseThemePreferences('{"mode":"invalid","light":"missing","dark":"current"}')).toEqual({
      mode: 'dark',
      light: 'default',
      dark: 'current',
    });
    expect(parseThemePreferences('null')).toEqual({
      mode: 'dark',
      light: 'default',
      dark: 'redvoice',
    });
  });
  it('resolves independent halves when the operating system changes', () => {
    const preferences = parseThemePreferences(
      '{"mode":"system","light":"canopy","dark":"current"}',
    );
    expect(resolveTheme(preferences, false)).toEqual({ appearance: 'light', paletteId: 'canopy' });
    expect(resolveTheme(preferences, true)).toEqual({ appearance: 'dark', paletteId: 'current' });
    expect(resolveTheme({ ...preferences, mode: 'light' }, true)).toEqual({
      appearance: 'light',
      paletteId: 'canopy',
    });
  });
  it('migrates previous palette names without changing the selected colors', () => {
    expect(parseThemePreferences('{"light":"t3-chat","dark":"voicestudio-classic"}')).toEqual({
      mode: 'dark',
      light: 'signal',
      dark: 'heritage',
    });
  });
  it('keeps Studio as a valid saved palette for both appearances', () => {
    const preferences = parseThemePreferences('{"mode":"dark","light":"default","dark":"default"}');
    expect(preferences).toEqual({ mode: 'dark', light: 'default', dark: 'default' });
    expect(resolveTheme(preferences, false)).toEqual({ appearance: 'dark', paletteId: 'default' });
  });
  it('ships complete semantic colors for both appearances of every palette', () => {
    expect(BUILT_IN_THEMES.map((theme) => theme.id)).toEqual([
      'signal',
      'canopy',
      'current',
      'hearth',
      'orchid',
    ]);
    for (const theme of AVAILABLE_PALETTES)
      for (const mode of ['light', 'dark'] as const) {
        const colors = paletteColors(theme.id, mode);
        for (const role of THEME_COLOR_ROLES)
          expect(colors?.[role], `${theme.id}/${mode}/${role}`).toEqual(expect.any(String));
      }
    expect(paletteColors('heritage', 'dark')?.canvas).toBe('#211c29');
    expect(paletteColors('heritage', 'dark')?.messageAction).toBe('#d3869b');
    expect(parseThemePreferences('{"dark":"heritage"}').dark).toBe('heritage');
    expect(paletteColors('default', 'dark')).toBeNull();
    expect(colorVariable('sidebarRowHover')).toBe('--app-theme-sidebar-row-hover');
    expect(colorVariable('terminalSelection')).toBe('--app-theme-terminal-selection-background');
  });
  it('starts a fresh install on the RedVoice dark palette and keeps any saved choice', () => {
    expect(resolveTheme(parseThemePreferences(null), true)).toEqual({
      appearance: 'dark',
      paletteId: 'redvoice',
    });
    expect(parseThemePreferences('{"dark":"default"}').dark).toBe('default');
    expect(parseThemePreferences('{"dark":"missing"}').dark).toBe('default');
    expect(parseThemePreferences('{"dark":"orchid"}').dark).toBe('orchid');
    expect(parseThemePreferences(null).light).toBe('default');
  });
  it('gives RedVoice a red action on neutral panels, with errors in a different colour', () => {
    const channels = (hex: string | undefined) =>
      [1, 3, 5].map((start) => parseInt((hex ?? '').slice(start, start + 2), 16));
    for (const appearance of ['light', 'dark'] as const) {
      const colors = paletteColors('redvoice', appearance)!;
      const [red, green, blue] = channels(colors.messageAction);
      expect(red, appearance).toBeGreaterThan(2 * Math.max(green, blue));
      const [r, g, b] = channels(colors.canvas);
      expect(Math.max(r, g, b) - Math.min(r, g, b), appearance).toBeLessThanOrEqual(4);
      expect(colors.error, appearance).not.toBe(colors.messageAction);
      expect(channels(colors.error)[1], appearance).toBeGreaterThan(green + 30);
    }
  });
  it("keeps Hearth's primary action colour clear of its destructive red", () => {
    const hue = (color: string | undefined) =>
      Number(/oklch\([\d.]+ [\d.]+ ([\d.]+)\)/.exec(color ?? '')?.[1]);
    for (const appearance of ['light', 'dark'] as const) {
      const colors = paletteColors('hearth', appearance)!;
      const gap = Math.abs(hue(colors.messageAction) - hue(colors.error));
      expect(Math.min(gap, 360 - gap), appearance).toBeGreaterThan(60);
    }
  });
});
