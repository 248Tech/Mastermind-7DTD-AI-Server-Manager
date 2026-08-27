'use client';

import { useCallback, useEffect } from 'react';
import type { ServerInstance } from './api';

const STORAGE_KEY = 'mm_selected_server_id';
const CHANGE_EVENT = 'mastermind-server-change';

export function getStoredServerId(): string {
  if (typeof window === 'undefined') return '';
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
}

export function setStoredServerId(serverId: string): void {
  if (typeof window === 'undefined' || !serverId) return;
  try { localStorage.setItem(STORAGE_KEY, serverId); } catch { /* Keep the selection for this page. */ }
  window.dispatchEvent(new CustomEvent<string>(CHANGE_EVENT, { detail: serverId }));
}

/**
 * Keeps the selected server consistent between dashboard pages. A saved choice
 * is used when it is still available; otherwise the first supplied server is
 * selected so single-server installations retain their existing behaviour.
 */
export function useServerSelection(
  servers: ServerInstance[],
  serverId: string,
  setServerId: (serverId: string) => void,
) {
  const resolve = useCallback((requested = getStoredServerId()) => {
    const next = servers.find((server) => server.id === requested)
      ?? servers.find((server) => server.id === serverId)
      ?? servers[0];
    if (next && next.id !== serverId) setServerId(next.id);
  }, [servers, serverId, setServerId]);

  useEffect(() => {
    resolve();
    const onChange = (event: Event) => {
      const requested = (event as CustomEvent<string>).detail;
      const next = servers.find((server) => server.id === requested);
      if (next && next.id !== serverId) setServerId(next.id);
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, [resolve, servers, serverId, setServerId]);

  return useCallback((nextServerId: string) => {
    if (!servers.some((server) => server.id === nextServerId)) return;
    setServerId(nextServerId);
    setStoredServerId(nextServerId);
  }, [servers, setServerId]);
}
