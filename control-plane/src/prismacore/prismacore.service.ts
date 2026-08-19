import { Injectable } from '@nestjs/common';
import { prismacoreConfigured, prismacoreGet, publicShopLive } from './prismacore.client';
import { normalizeClaims, normalizeHomes, normalizeMarkers, normalizePlayers, normalizePois, normalizeRects, parseAdvClaimType } from './prismacore.normalize';
import { ADV_CLAIM_TYPES, type PrismaCoreLayer, type PrismaCoreRect } from './prismacore.types';

type CacheEntry = { at: number; value: unknown };

const WRITE_BLOCK = new Set(['createadvclaims']);

@Injectable()
export class PrismaCoreService {
  private readonly cache = new Map<string, CacheEntry>();

  configured() {
    return prismacoreConfigured();
  }

  async status() {
    if (!this.configured()) return { configured: false, reachable: false };
    const result = await this.fetchJson('/api/getplayersonline', {}, 10_000);
    return { configured: true, reachable: result.ok };
  }

  async shopLive() {
    const layer = await this.layer('playersonline') as unknown as { reachable?: boolean; players?: unknown[] };
    const players = Array.isArray(layer.players) ? layer.players.length : 0;
    return publicShopLive({ reachable: Boolean(layer.reachable), playersOnline: players });
  }

  async layer(layer: PrismaCoreLayer, type?: string) {
    if (WRITE_BLOCK.has(layer) || layer === 'status') return this.status();
    if (!this.configured()) return { configured: false, reachable: false };
    switch (layer) {
      case 'playersonline':
        return this.cached('playersonline', 10_000, async () => {
          const result = await this.fetchJson('/api/getplayersonline');
          return { configured: true, reachable: result.ok, players: result.ok ? normalizePlayers(result.json) : [] };
        });
      case 'landclaims':
        return this.cached('landclaims', 15_000, async () => {
          const result = await this.fetchJson('/api/getlandclaims');
          return { configured: true, reachable: result.ok, claims: result.ok ? normalizeClaims(result.json) : [] };
        });
      case 'playerhomes':
        return this.cached('playerhomes', 15_000, async () => {
          const result = await this.fetchJson('/api/getplayerhomes');
          return { configured: true, reachable: result.ok, homes: result.ok ? normalizeHomes(result.json) : [] };
        });
      case 'vehicles':
        return this.cached('vehicles', 15_000, async () => {
          const result = await this.fetchJson('/api/getvehicles');
          return { configured: true, reachable: result.ok, markers: result.ok ? normalizeMarkers(result.json, ['Vehicles', 'vehicles'], 'vehicle') : [] };
        });
      case 'drones':
        return this.cached('drones', 15_000, async () => {
          const result = await this.fetchJson('/api/getdrones');
          return { configured: true, reachable: result.ok, markers: result.ok ? normalizeMarkers(result.json, ['Drones', 'drones'], 'drone') : [] };
        });
      case 'traders':
        return this.cached('traders', 15_000, async () => {
          const result = await this.fetchJson('/api/gettraders');
          return { configured: true, reachable: result.ok, markers: result.ok ? normalizeMarkers(result.json, ['Traders', 'traders'], 'trader') : [] };
        });
      case 'questpois':
        return this.cached('questpois', 15_000, async () => {
          const result = await this.fetchJson('/api/getquestpois');
          return { configured: true, reachable: result.ok, pois: result.ok ? normalizePois(result.json, ['QuestPOIs', 'questpois', 'pois']) : [] };
        });
      case 'allpois':
        return this.cached('allpois', 60_000, async () => {
          const result = await this.fetchJson('/api/getallpois', {}, 8_000);
          return {
            configured: true,
            reachable: result.ok,
            pois: result.ok
              ? normalizePois(result.json, ['AllPOIs', 'allPOIs', 'allpois', 'AllPois', 'POIs', 'Pois', 'pois', 'data', 'results', 'items'])
              : [],
          };
        });
      case 'resetregions':
        return this.cached('resetregions', 15_000, async () => {
          const result = await this.fetchJson('/api/getresetregions');
          return { configured: true, reachable: result.ok, regions: result.ok ? normalizeRects(result.json, 'reset') : [] };
        });
      case 'advclaims': {
        const selected = parseAdvClaimType(type);
        const types = selected ? [selected] : [...ADV_CLAIM_TYPES];
        const claims: PrismaCoreRect[] = [];
        let reachable = false;
        for (const claimType of types) {
          const piece = await this.cached(`advclaims:${claimType}`, 15_000, async () => {
            const result = await this.fetchJson('/api/getadvclaims', { type: claimType });
            return { ok: result.ok, rects: result.ok ? normalizeRects(result.json, claimType) : [] };
          });
          if (piece.ok) reachable = true;
          claims.push(...piece.rects);
        }
        return { configured: true, reachable, claims };
      }
      default:
        return { configured: this.configured(), reachable: false };
    }
  }

  private async fetchJson(path: string, query: Record<string, string | undefined> = {}, timeoutMs = 5000) {
    return prismacoreGet(path, query, process.env, timeoutMs);
  }

  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
    const value = await load();
    this.cache.set(key, { at: Date.now(), value });
    if (this.cache.size > 40) {
      for (const [entryKey, entry] of this.cache) {
        if (Date.now() - entry.at > 120_000) this.cache.delete(entryKey);
      }
    }
    return value;
  }
}
