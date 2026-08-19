import { BadGatewayException, BadRequestException, ConflictException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DUMMY_PASSWORD_HASH, makePasswordHash, verifyPassword } from '../auth/auth.service';
import { stripeCheckoutEnabledForOrg } from '../donations/donations.credentials';
import { PrismaService } from '../prisma.service';
import { PrismaCoreService } from '../prismacore/prismacore.service';
import { parsePortalPassword, parsePortalPlayerName, parseShopReturnPath } from './player-auth.names';
import { emptyPlayerPlaces, filterPlayerPlaces } from './player-places';

const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const CLAIMED_ID = /^https?:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/;

@Injectable()
export class PlayerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly prismaCore: PrismaCoreService,
  ) {}

  async verifySteam(serverInstanceId: string, returnTo: string, openid: Record<string, unknown>) {
    if (!serverInstanceId || !/^c[a-z0-9]{10,40}$/i.test(serverInstanceId)) throw new BadRequestException('Valid server required');
    let callback: URL;
    try { callback = new URL(returnTo); } catch { throw new BadRequestException('Invalid Steam return URL'); }
    if (!['http:', 'https:'].includes(callback.protocol)) throw new BadRequestException('Invalid Steam return URL');
    const params = new URLSearchParams();
    const entries = Object.entries(openid ?? {});
    if (entries.length > 32) throw new BadRequestException('Steam identity response is too large');
    for (const [key, value] of entries) {
      if (key.startsWith('openid.') && typeof value === 'string' && value.length <= 4096) params.set(key, value);
    }
    const claimed = params.get('openid.claimed_id') ?? '';
    const identity = params.get('openid.identity') ?? '';
    const steam = CLAIMED_ID.exec(claimed)?.[1];
    if (!steam || identity !== claimed || params.get('openid.mode') !== 'id_res') throw new UnauthorizedException('Steam identity response is invalid');
    const provider = params.get('openid.op_endpoint')?.replace(/\/$/, '');
    if (!['https://steamcommunity.com/openid', STEAM_OPENID].includes(provider ?? '')) throw new UnauthorizedException('Unexpected Steam identity provider');
    if (params.get('openid.return_to') !== returnTo) throw new UnauthorizedException('Steam return URL did not match');
    params.set('openid.mode', 'check_authentication');
    const response = await fetch(STEAM_OPENID, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!response?.ok) throw new BadGatewayException('Steam verification is unavailable');
    const verification = await response.text();
    if (!/(?:^|\n)is_valid:true(?:\r?$|\n)/m.test(verification)) throw new UnauthorizedException('Steam could not verify this login');
    const player = await this.prisma.player.findFirst({
      where: { serverInstanceId, steamId: steam },
      select: { id: true, steamId: true, entityId: true, name: true, online: true, serverInstance: { select: { id: true, name: true } } },
    });
    if (!player?.steamId) throw new UnauthorizedException('This Steam account has not played on this server');
    const access_token = this.jwt.sign(
      { sub: player.id, kind: 'player', auth: 'steam', steamId: player.steamId, serverInstanceId },
      { secret: process.env.PLAYER_JWT_SECRET || process.env.JWT_SECRET || 'change-me-user-secret', expiresIn: '12h' },
    );
    return { access_token, player: { name: player.name, steamId: player.steamId, serverInstanceId, serverName: player.serverInstance.name, auth: 'steam' as const } };
  }

  async portalServer() {
    const configured = (process.env.PLAYER_PORTAL_SERVER_ID || '').trim();
    if (/^c[a-z0-9]{10,40}$/i.test(configured)) {
      const server = await this.prisma.serverInstance.findFirst({
        where: { id: configured },
        select: { id: true, orgId: true, name: true },
      });
      if (server) return server;
    }
    const servers = await this.prisma.serverInstance.findMany({ take: 2, select: { id: true, orgId: true, name: true } });
    if (servers.length === 1) return servers[0];
    throw new ServiceUnavailableException('Player portal server is not configured');
  }

  async shopStatus() {
    const server = await this.portalServer();
    const live = await this.prismaCore.shopLive();
    return {
      serverName: server.name,
      checkoutEnabled: await stripeCheckoutEnabledForOrg(this.prisma, server.orgId),
      serverReachable: live.serverReachable,
      playersOnline: live.playersOnline,
    };
  }

  async registerName(input: { name?: unknown; password?: unknown; next?: unknown }) {
    const name = parsePortalPlayerName(input.name);
    const password = parsePortalPassword(input.password);
    if (!name) throw new BadRequestException('Enter your in-game name exactly as it appears on the server');
    if (!password) throw new BadRequestException('Choose a password of at least 8 characters');
    const server = await this.portalServer();
    const matches = await this.prisma.player.findMany({
      where: { serverInstanceId: server.id, name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true, steamId: true, portalPasswordHash: true, serverInstance: { select: { name: true } } },
      take: 3,
    });
    if (matches.length === 0) {
      throw new ConflictException('That in-game name has not been seen on this server yet. Join the game once, or sign in through Steam.');
    }
    if (matches.length > 1) {
      throw new ConflictException('That name matches more than one player. Sign in through Steam to continue.');
    }
    const player = matches[0];
    if (player.portalPasswordHash) {
      throw new ConflictException('An account already exists for that name. Sign in instead.');
    }
    await this.prisma.player.update({
      where: { id: player.id },
      data: { portalPasswordHash: makePasswordHash(password) },
    });
    return this.issueNameSession(player, server.id, player.serverInstance.name, input.next);
  }

  async loginName(input: { name?: unknown; password?: unknown; next?: unknown }) {
    const name = parsePortalPlayerName(input.name);
    const password = parsePortalPassword(input.password);
    if (!name || !password) throw new UnauthorizedException('In-game name or password is incorrect');
    const server = await this.portalServer();
    const matches = await this.prisma.player.findMany({
      where: { serverInstanceId: server.id, name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true, steamId: true, portalPasswordHash: true, serverInstance: { select: { name: true } } },
      take: 3,
    });
    const player = matches.length === 1 ? matches[0] : null;
    const valid = verifyPassword(password, player?.portalPasswordHash || DUMMY_PASSWORD_HASH);
    if (!player || !player.portalPasswordHash || !valid) {
      throw new UnauthorizedException('In-game name or password is incorrect');
    }
    return this.issueNameSession(player, server.id, player.serverInstance.name, input.next);
  }

  private issueNameSession(
    player: { id: string; name: string; steamId: string | null },
    serverInstanceId: string,
    serverName: string,
    nextRaw: unknown,
  ) {
    const access_token = this.jwt.sign(
      { sub: player.id, kind: 'player', auth: 'name', serverInstanceId },
      { secret: process.env.PLAYER_JWT_SECRET || process.env.JWT_SECRET || 'change-me-user-secret', expiresIn: '12h' },
    );
    return {
      access_token,
      next: parseShopReturnPath(nextRaw),
      player: { name: player.name, steamId: player.steamId, serverInstanceId, serverName, auth: 'name' as const },
    };
  }

  async requirePlayer(token: string) {
    let payload: { sub?: string; kind?: string; auth?: string; steamId?: string; serverInstanceId?: string };
    try {
      payload = await this.jwt.verifyAsync(token, { secret: process.env.PLAYER_JWT_SECRET || process.env.JWT_SECRET || 'change-me-user-secret' });
    } catch { throw new UnauthorizedException('Player session expired'); }
    if (payload.kind !== 'player' || !payload.sub || !payload.serverInstanceId) throw new UnauthorizedException('Player session invalid');
    const sessionAuth: 'steam' | 'name' = payload.auth === 'name' ? 'name' : 'steam';
    if (sessionAuth === 'steam' && !payload.steamId) throw new UnauthorizedException('Player session invalid');
    const player = await this.prisma.player.findFirst({
      where: {
        id: payload.sub,
        serverInstanceId: payload.serverInstanceId,
        ...(sessionAuth === 'steam' ? { steamId: payload.steamId } : {}),
      },
      select: {
        id: true, orgId: true, steamId: true, eosId: true, entityId: true, name: true, online: true, serverInstanceId: true,
        zombieKills: true, playerKills: true, deaths: true, level: true, lifetimeSeconds: true,
        currentSessionStartedAt: true, firstSeenAt: true, lastSeenAt: true, lastLogoutAt: true,
        lastPosX: true, lastPosY: true, lastPosZ: true, lastInventory: true, lastInventoryAt: true,
        supporter: true, supporterSince: true, totalDonatedCents: true, portalPasswordHash: true,
        serverInstance: { select: { name: true } },
      },
    });
    if (!player) throw new UnauthorizedException('Player no longer registered');
    if (sessionAuth === 'steam' && !player.steamId) throw new UnauthorizedException('Player no longer registered');
    if (sessionAuth === 'name' && !player.portalPasswordHash) throw new UnauthorizedException('Player session invalid');
    const { portalPasswordHash: _hash, ...safe } = player;
    return { ...safe, sessionAuth } as typeof safe & { sessionAuth: 'steam' | 'name' };
  }

  async profile(token: string) {
    const player = await this.requirePlayer(token);
    // Dashboard accounts and game players are intentionally separate records.
    // When an administrator has linked the same display name to a player, expose
    // only a boolean so the portal can offer a convenient dashboard link.
    const adminNames = await this.prisma.userOrg.findMany({
      where: { orgId: player.orgId, role: { name: 'admin' }, user: { name: { not: null } } },
      select: { user: { select: { name: true } } },
    });
    const isAdmin = adminNames.some(row => row.user.name?.trim().toLocaleLowerCase() === player.name.trim().toLocaleLowerCase());
    const checkoutEnabled = await stripeCheckoutEnabledForOrg(this.prisma, player.orgId);
    const steamLast4 = player.steamId ? player.steamId.slice(-4) : '';
    if (player.sessionAuth === 'name') {
      return {
        playerId: player.id,
        steamId: player.steamId,
        entityId: null,
        name: player.name,
        online: false,
        auth: 'name' as const,
        isAdmin,
        serverInstanceId: player.serverInstanceId,
        serverName: player.serverInstance.name,
        donation: {
          status: player.supporter ? 'supporter' : 'ready',
          tiedTo: 'name',
          steamLast4,
          checkoutEnabled,
          supporter: player.supporter,
          supporterSince: player.supporterSince?.toISOString() ?? null,
          totalDonatedCents: player.totalDonatedCents,
          recent: [],
        },
      };
    }
    const now = Date.now();
    const sessionSeconds = player.online && player.currentSessionStartedAt ? Math.max(0, Math.floor((now - player.currentSessionStartedAt.getTime()) / 1000)) : 0;
    const hasPosition = player.lastPosX != null && player.lastPosZ != null;
    const recent = await this.prisma.donation.findMany({
      where: { playerId: player.id, status: 'completed' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { amountCents: true, createdAt: true },
    });
    return {
      playerId: player.id,
      steamId: player.steamId,
      entityId: player.online ? player.entityId : null,
      name: player.name,
      online: player.online,
      auth: 'steam' as const,
      isAdmin,
      serverInstanceId: player.serverInstanceId,
      serverName: player.serverInstance.name,
      stats: {
        level: player.level,
        zombieKills: player.zombieKills,
        playerKills: player.playerKills,
        deaths: player.deaths,
        sessionSeconds,
        lifetimeSeconds: player.lifetimeSeconds + sessionSeconds,
        firstSeenAt: player.firstSeenAt.toISOString(),
        lastSeenAt: player.lastSeenAt.toISOString(),
      },
      location: hasPosition ? {
        x: player.lastPosX,
        y: player.lastPosY,
        z: player.lastPosZ,
        lastLogoutAt: player.lastLogoutAt?.toISOString() ?? null,
        source: player.online ? 'last_reported' : 'last_logout',
      } : null,
      inventory: player.lastInventory ?? null,
      inventoryAt: player.lastInventoryAt?.toISOString() ?? null,
      donation: {
        status: player.supporter ? 'supporter' : 'ready',
        tiedTo: 'steam',
        steamLast4,
        checkoutEnabled,
        supporter: player.supporter,
        supporterSince: player.supporterSince?.toISOString() ?? null,
        totalDonatedCents: player.totalDonatedCents,
        recent: recent.map((row) => ({ amountCents: row.amountCents, at: row.createdAt.toISOString() })),
      },
    };
  }

  async places(token: string) {
    const player = await this.requirePlayer(token);
    if (player.sessionAuth === 'name') return emptyPlayerPlaces('name');
    const [claimsLayer, homesLayer, vehiclesLayer, dronesLayer] = await Promise.all([
      this.prismaCore.layer('landclaims'),
      this.prismaCore.layer('playerhomes'),
      this.prismaCore.layer('vehicles'),
      this.prismaCore.layer('drones'),
    ]);
    const claims = claimsLayer as { reachable?: boolean; claims?: unknown[] };
    const homes = homesLayer as { reachable?: boolean; homes?: unknown[] };
    const vehicles = vehiclesLayer as { reachable?: boolean; markers?: unknown[] };
    const drones = dronesLayer as { reachable?: boolean; markers?: unknown[] };
    return filterPlayerPlaces({
      reachable: Boolean(claims.reachable || homes.reachable || vehicles.reachable || drones.reachable),
      claims: Array.isArray(claims.claims) ? claims.claims as Array<{ steamId?: unknown; eosId?: unknown; extra?: unknown; position?: { x: number; y: number; z: number }; size?: number }> : [],
      homes: Array.isArray(homes.homes) ? homes.homes as Array<{ steamId?: unknown; eosId?: unknown; extra?: unknown; position?: { x: number; y: number; z: number }; active?: boolean }> : [],
      vehicles: Array.isArray(vehicles.markers) ? vehicles.markers as Array<{ steamId?: unknown; eosId?: unknown; extra?: unknown; name?: string; position?: { x: number; y: number; z: number } }> : [],
      drones: Array.isArray(drones.markers) ? drones.markers as Array<{ steamId?: unknown; eosId?: unknown; extra?: unknown; name?: string; position?: { x: number; y: number; z: number } }> : [],
    }, { steamId: player.steamId, eosId: player.eosId });
  }
}
