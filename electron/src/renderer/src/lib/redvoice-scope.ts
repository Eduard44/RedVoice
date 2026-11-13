import { useSyncExternalStore } from 'react';
import { ONLINE_SERVICES } from '@shared/app-config';
import { onStorageKey } from '@/lib/storage-events';

/**
 * RedVoice v1 is voice cloning and text to speech. The other workspaces that
 * come with the upstream app stay in the code and stay reachable, but are left
 * out of the navigation until the user turns them on in Settings.
 */
const CORE_ROUTES = new Set(['/', '/clone', '/script', '/personas', '/projects', '/settings']);
const KEY = 'redvoice.all-features';

/** False when this build keeps the upstream project's online services off. */
export const onlineServices = ONLINE_SERVICES;

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

let showAll = read();
const listeners = new Set<() => void>();
onStorageKey(KEY, () => {
  showAll = read();
  listeners.forEach((listener) => listener());
});

export function setShowAllFeatures(value: boolean) {
  showAll = value;
  try {
    localStorage.setItem(KEY, String(value));
  } catch {
    /* The choice still applies for this session. */
  }
  listeners.forEach((listener) => listener());
}

/** Whether the user asked to see every workspace, not only the v1 ones. */
export function useShowAllFeatures(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => showAll,
    () => false,
  );
}

/** Whether a workspace route belongs in the navigation. */
export function featureVisible(route: string, allFeatures: boolean): boolean {
  if (route === '/pro') return onlineServices && allFeatures;
  if (allFeatures) return true;
  return [...CORE_ROUTES].some(
    (core) => route === core || (core !== '/' && route.startsWith(`${core}/`)),
  );
}
