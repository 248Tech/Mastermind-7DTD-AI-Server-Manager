import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaCoreService } from '../prismacore/prismacore.service';
import type { InventorySnapshot } from '../players/player-inventory';
import { parseAllocsInventoryJson } from '../players/player-inventory';
import { allocsConfigured, allocsGet, allocsTokenConfigured } from './allocs.client';
import { allowedAllocsConsoleCommand, consoleResultText } from './allocs.console';
import { allocsUserId, normalizeAllocsEntities, normalizeAllocsPlayers, publicMapEntities, type MapEntity } from './allocs.normalize';

type CacheEntry = { at: number; value: unknown };

@Injectable()
export class AllocsService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prismaCore: PrismaCoreService) {}

  configured() {
    return allocsConfigured();
  }

  tokenConfigured() {
    return allocsTokenConfigured();
  }

  async staffEntities() {
    const [players, hostiles, animals] = await Promise.all([
      this.playersForMap(),
      this.cached('hostiles', 5_000, () => this.locationLayer('gethostilelocation', 'hostile', ['hostiles', 'Hostiles', 'data', 'result'])),
      this.cached('animals', 5_000, () => this.locationLayer('getanimalslocation', 'animal', ['animals', 'Animals', 'data', 'result'])),
    ]);
    return publicMapEntities({
      players: players.players,
      hostiles: hostiles.entities,
      animals: animals.entities,
      errors: {
        ...(players.error ? { players: players.error } : {}),
        ...(hostiles.error ? { hostiles: hostiles.error } : {}),
        ...(animals.error ? { animals: animals.error } : {}),
      },
    });
  }

  async playerMapEntities(includePlayers: boolean) {
    const payload = await this.staffEntities();
    return publicMapEntities({
      players: includePlayers ? payload.players : [],
      animals: payload.animals,
      hostiles: payload.hostiles,
      playerVisibility: includePlayers ? 'verified' : 'hidden',
      errors: payload.errors,
    });
  }

  async inventorySnapshot(steamId?: string | null, eosId?: string | null): Promise<InventorySnapshot | null> {
    if (!this.tokenConfigured()) return null;
    const userid = allocsUserId(steamId, eosId);
    if (!userid) return null;
    const result = await allocsGet('getplayerinventory', { userid });
    if (!result.ok) return null;
    return parseAllocsInventoryJson(result.json);
  }

  async executeAllowed(command: unknown) {
    const allowed = allowedAllocsConsoleCommand(command);
    if (!allowed) throw new BadRequestException('Only visitmap start/stop is allowed');
    if (!this.tokenConfigured()) {
      throw new ServiceUnavailableException('Allocs webtoken is not configured');
    }
    const result = await allocsGet('executeconsolecommand', { command: allowed }, process.env, 8_000);
    if (!result.ok) {
      throw new ServiceUnavailableException(
        result.configured ? 'Allocs console command failed' : 'Allocs WebAPI is not configured',
      );
    }
    return { ok: true, command: allowed, result: consoleResultText(result.json) };
  }

  private async playersForMap(): Promise<{ players: MapEntity[]; error?: string }> {
    if (this.prismaCore.configured()) {
      const layer = await this.prismaCore.layer('playersonline') as { reachable?: boolean; players?: Array<{ id: string; name: string; position: { x: number; y: number; z: number } }> };
      if (layer.reachable && Array.isArray(layer.players)) {
        return {
          players: layer.players.map((player) => ({
            id: player.id,
            name: player.name,
            type: 'EntityPlayer',
            position: player.position,
          })),
        };
      }
    }
    const result = await allocsGet('getplayerslocation');
    if (!result.ok) {
      return {
        players: [],
        error: result.configured ? 'Player locations unavailable' : undefined,
      };
    }
    return { players: normalizeAllocsPlayers(result.json) };
  }

  private async locationLayer(endpoint: string, type: string, keys: string[]) {
    if (!this.configured()) return { entities: [] as MapEntity[], error: 'Allocs WebAPI is not configured' };
    const result = await allocsGet(endpoint);
    if (!result.ok) {
      return {
        entities: [] as MapEntity[],
        error: result.configured ? `${type} locations unavailable` : 'Allocs WebAPI is not configured',
      };
    }
    return { entities: normalizeAllocsEntities(result.json, type, keys) };
  }

  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
    const value = await load();
    this.cache.set(key, { at: Date.now(), value });
    if (this.cache.size > 20) {
      for (const [entryKey, entry] of this.cache) {
        if (Date.now() - entry.at > 60_000) this.cache.delete(entryKey);
      }
    }
    return value;
  }
}
