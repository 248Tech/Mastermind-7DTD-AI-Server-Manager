import { gunzipSync } from 'zlib';

export type PoiCatalogEntry = { name: string; hasPreview: boolean };
export type PoiCatalogView = { items: PoiCatalogEntry[]; count: number; truncated: boolean };

const NAME = /^[A-Za-z0-9_.-]{1,160}$/;

export function poiCatalogFromAgentResult(raw: Record<string, unknown> | undefined | null): PoiCatalogView {
  const seen = new Set<string>();
  const items: PoiCatalogEntry[] = [];
  const encoded = typeof raw?.catalogGz === 'string' ? raw.catalogGz : '';
  if (encoded && encoded.length <= 400_000) {
    try {
      const text = gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
      for (const line of text.split('\n')) {
        const [name, preview] = line.split('\t', 2);
        if (!NAME.test(name) || seen.has(name)) continue;
        seen.add(name);
        items.push({ name, hasPreview: preview === '1' });
        if (items.length >= 5_000) break;
      }
    } catch { /* Invalid remote catalog: return an empty safe result. */ }
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { items, count: items.length, truncated: raw?.truncated === true || items.length >= 5_000 };
}
