import { expect, test } from 'vitest';
import { applicationUpdatesUnsupportedReason } from './distribution';

test('a build with online services off never checks the upstream feed for updates', () => {
  expect(applicationUpdatesUnsupportedReason(true, 'direct', undefined, true)).toBe(
    'package-manager',
  );
});
