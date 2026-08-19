'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'mm_shop_cart_v1';

function readIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { ids?: unknown };
    if (!Array.isArray(parsed.ids)) return [];
    return parsed.ids.filter((id): id is string => typeof id === 'string' && /^[a-z0-9_-]{10,40}$/i.test(id));
  } catch {
    return [];
  }
}

function writeIds(ids: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ids }));
  window.dispatchEvent(new Event('mm-shop-cart'));
}

export function useShopCart() {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    setIds(readIds());
    function sync() {
      setIds(readIds());
    }
    window.addEventListener('mm-shop-cart', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('mm-shop-cart', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const add = useCallback((itemId: string) => {
    const next = readIds();
    if (!next.includes(itemId)) next.push(itemId);
    writeIds(next);
    setIds(next);
  }, []);

  const remove = useCallback((itemId: string) => {
    const next = readIds().filter((id) => id !== itemId);
    writeIds(next);
    setIds(next);
  }, []);

  const clear = useCallback(() => {
    writeIds([]);
    setIds([]);
  }, []);

  const has = useCallback((itemId: string) => ids.includes(itemId), [ids]);

  return { ids, count: ids.length, add, remove, clear, has };
}
