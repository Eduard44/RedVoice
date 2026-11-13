import { describe, expect, it } from 'vitest';
import { featureVisible, onlineServices, setShowAllFeatures } from './redvoice-scope';

describe('RedVoice v1 scope', () => {
  it('shows only voice cloning workspaces until all features are turned on', () => {
    for (const route of ['/', '/clone', '/personas', '/projects', '/settings/general'])
      expect(featureVisible(route, false), route).toBe(true);
    for (const route of [
      '/dub',
      '/batch',
      '/stories',
      '/audiobook',
      '/design',
      '/gallery',
      '/transcriptions',
      '/workflows',
      '/calls',
      '/tools',
      '/integrations',
    ])
      expect(featureVisible(route, false), route).toBe(false);
    for (const route of ['/dub', '/stories', '/transcriptions', '/workflows'])
      expect(featureVisible(route, true), route).toBe(true);
  });
  it('never offers Pro while online services are off', () => {
    expect(onlineServices).toBe(false);
    expect(featureVisible('/pro', true)).toBe(false);
    expect(featureVisible('/pro', false)).toBe(false);
  });
  it('remembers the choice', () => {
    setShowAllFeatures(true);
    expect(localStorage.getItem('redvoice.all-features')).toBe('true');
    setShowAllFeatures(false);
    expect(localStorage.getItem('redvoice.all-features')).toBe('false');
  });
});
