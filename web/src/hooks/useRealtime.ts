'use client';
import { useEffect, useRef } from 'react';

/** Poll a fetch function on an interval. Calls onData with fresh data. */
export function usePoll<T>(
  fetchFn: () => Promise<T>,
  onData: (data: T) => void,
  intervalMs = 5000,
  enabled = true,
) {
  const fn = useRef(fetchFn);
  const cb = useRef(onData);
  fn.current = fetchFn;
  cb.current = onData;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const run = async () => {
      try {
        const data = await fn.current();
        if (active) cb.current(data);
      } catch {
        // silently ignore poll errors
      }
    };
    run();
    const id = setInterval(run, intervalMs);
    return () => { active = false; clearInterval(id); };
  }, [intervalMs, enabled]);
}

export function useRealtime() {
  return {};
}
