import { gunzipSync } from 'zlib';
import { parseGrantItemName } from './shop-grants';

export const MAX_ITEM_CATALOG_NAMES = 25_000;
export const ITEM_CATALOG_CACHE_MS = 24 * 60 * 60 * 1000;

export type ItemCatalogView = {
  items: string[];
  count: number;
  files?: number;
  truncated?: boolean;
};

export function catalogFromAgentResult(raw: Record<string, unknown> | undefined | null): ItemCatalogView {
  const names = new Set<string>();
  const catalogGz = typeof raw?.catalogGz === 'string' ? raw.catalogGz : '';
  if (catalogGz && catalogGz.length <= 400_000) {
    try {
      const text = gunzipSync(Buffer.from(catalogGz, 'base64')).toString('utf8');
      for (const line of text.split('\n')) {
        const name = parseGrantItemName(line);
        if (!name) continue;
        names.add(name);
        if (names.size >= MAX_ITEM_CATALOG_NAMES) break;
      }
    } catch {
      // Ignore a corrupt agent payload and fall through to any plaintext names.
    }
  }
  if (Array.isArray(raw?.items) && names.size < MAX_ITEM_CATALOG_NAMES) {
    for (const row of raw.items) {
      const name = parseGrantItemName(row);
      if (!name) continue;
      names.add(name);
      if (names.size >= MAX_ITEM_CATALOG_NAMES) break;
    }
  }
  const items = [...names].sort((a, b) => a.localeCompare(b));
  const files = Number(raw?.files);
  return {
    items,
    count: items.length,
    files: Number.isInteger(files) && files >= 0 ? files : undefined,
    truncated: raw?.truncated === true || items.length >= MAX_ITEM_CATALOG_NAMES,
  };
}
