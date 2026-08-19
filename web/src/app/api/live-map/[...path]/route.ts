import { NextRequest } from "next/server";
import { readFile, readdir, open } from "fs/promises";
import pathModule from "path";
export const dynamic = "force-dynamic";
const allowed =
  /^(entities-live|claims-live|regions-live|world-info|visitmap-status|api\/(map\/config|serverstats)|map\/\d+\/-?\d+\/-?\d+\.png)$/;
// PrismaCore overlays and Allocs hostiles/animals/inventory stay on the
// control plane so apiuser / webtoken credentials never leave it.
type AuthProfile = { orgs?: Array<{ orgId: string }> };

async function offlineMapConfig() {
  let maxZoom = 4;
  try {
    const levels = await readdir("/7dtd-map", { withFileTypes: true });
    const zooms = levels
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => Number(entry.name));
    if (zooms.length) maxZoom = Math.max(...zooms);
  } catch {
    // The caller will still get a useful response; missing tiles return 404.
  }

  let mapSize = 10240;
  try {
    const files = await readdir("/7dtd-save/Region", { withFileTypes: true });
    const coordinates = files.flatMap((entry) => {
      const match = entry.isFile()
        ? /^r\.(-?\d+)\.(-?\d+)\.7rg$/i.exec(entry.name)
        : null;
      return match ? [[Number(match[1]), Number(match[2])]] : [];
    });
    if (coordinates.length) {
      const xs = coordinates.map(([x]) => x);
      const zs = coordinates.map(([, z]) => z);
      mapSize = Math.max(
        (Math.max(...xs) - Math.min(...xs) + 1) * 512,
        (Math.max(...zs) - Math.min(...zs) + 1) * 512,
      );
    }
  } catch {
    // 10240 is a safe display extent for this installation.
  }

  return {
    enabled: true,
    mapBlockSize: 128,
    maxZoom,
    mapSize: { x: mapSize, y: 255, z: mapSize },
    offline: true,
  };
}
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const token = request.cookies.get("mm_live_map_session")?.value;
  if (!token)
    return Response.json(
      { message: "Live Map session required" },
      { status: 401 },
    );
  const control = (
    process.env.CONTROL_PLANE_INTERNAL_URL || "http://control-plane:3001"
  ).replace(/\/$/, "");
  const auth = await fetch(`${control}/api/auth/me`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);
  if (!auth?.ok)
    return Response.json(
      { message: "Live Map session expired" },
      { status: 401 },
    );
  const routeParams = await params;
  const path = (routeParams.path || []).join("/");
  if (!allowed.test(path))
    return Response.json(
      { message: "Unsupported map resource" },
      { status: 404 },
    );
  if (path === "claims-live") {
    try {
      const xml = (await readFile("/7dtd-save/players.xml", "utf8")).replace(
        /^\uFEFF/,
        "",
      );
      const claims: Array<{
        id: string;
        owner: string;
        eosId: string;
        steamId: string;
        position: { x: number; y: number; z: number };
        size: number;
      }> = [];
      const decode = (s: string) =>
        s
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&");
      const players = /<player\s+([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/player>)/g;
      let player;
      while ((player = players.exec(xml))) {
        const attrs = player[1],
          body = player[2] || "";
        const attr = (name: string) =>
          decode(attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1] || "");
        const owner = attr("playername") || "Unknown player",
          eosId = attr("userid"),
          steamId = attr("nativeuserid");
        const blocks = /<lpblock\s+pos="(-?\d+),(-?\d+),(-?\d+)"\s*\/>/g;
        let block;
        while ((block = blocks.exec(body))) {
          const position = {
            x: Number(block[1]),
            y: Number(block[2]),
            z: Number(block[3]),
          };
          claims.push({
            id: `${eosId}:${position.x}:${position.y}:${position.z}`,
            owner,
            eosId,
            steamId,
            position,
            size: 51,
          });
        }
      }
      return Response.json(
        { data: { claims } },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      return Response.json(
        {
          message:
            error instanceof Error ? error.message : "Land claims unavailable",
        },
        { status: 503 },
      );
    }
  }
  if (path === "world-info") {
    try {
      const xml = (await readFile("/7dtd-world/map_info.xml", "utf8")).replace(
        /^\uFEFF/,
        "",
      );
      const property = (name: string) =>
        xml.match(
          new RegExp(
            `<property\\s+name=["']${name}["']\\s+value=["']([^"']*)["']`,
            "i",
          ),
        )?.[1] || "";
      const dimensions = property("HeightMapSize")
        .split(",")
        .map((value) => Number(value.trim()));
      if (
        dimensions.length !== 2 ||
        dimensions.some((value) => !Number.isFinite(value) || value <= 0)
      ) {
        throw new Error("HeightMapSize is missing from map_info.xml");
      }
      return Response.json(
        {
          data: {
            width: dimensions[0],
            height: dimensions[1],
            gameVersion: property("GameVersion"),
            seed: property("Seed"),
            source: "map_info.xml",
          },
        },
        { headers: { "cache-control": "private, max-age=300" } },
      );
    } catch (error) {
      return Response.json(
        {
          message:
            error instanceof Error ? error.message : "World information unavailable",
        },
        { status: 503 },
      );
    }
  }
  if (path === "visitmap-status") {
    try {
      const handle = await open("/7dtd-logs/server.log", "r");
      try {
        const info = await handle.stat();
        const length = Math.min(info.size, 512 * 1024);
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, Math.max(0, info.size - length));
        const lines = buffer.toString("utf8").split(/\r?\n/);
        let progress: {
          percent: number;
          done: number;
          total: number;
          estimatedSeconds: number | null;
          at: string;
          timestamp: number;
        } | null = null;
        let stopTimestamp = 0;
        let startTimestamp = 0;
        let terminal: { state: "stopped" | "complete"; timestamp: number } | null = null;
        for (const line of lines) {
          const timestampText = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/)?.[1];
          const timestamp = timestampText ? Date.parse(`${timestampText}Z`) : 0;
          const match = /VisitMap \((\d+)%\):\s*(\d+)\s*\/\s*(\d+) chunks done(?: \(estimated time left ([\d.]+) seconds\))?/i.exec(line);
          if (match) {
            progress = {
              percent: Number(match[1]),
              done: Number(match[2]),
              total: Number(match[3]),
              estimatedSeconds: match[4] ? Number(match[4]) : null,
              at: timestampText ? `${timestampText}Z` : "",
              timestamp,
            };
          }
          if (/Executing command 'visitmap stop'/i.test(line)) stopTimestamp = timestamp;
          else if (/Executing command 'visitmap (?:full|-?\d+)/i.test(line)) startTimestamp = timestamp;
          if (/VisitMap/i.test(line) && !/chunks done/i.test(line)) {
            if (/\b(?:stopped|cancelled|canceled|aborted)\b/i.test(line)) terminal = { state: "stopped", timestamp };
            else if (/\b(?:completed|complete|finished)\b/i.test(line)) terminal = { state: "complete", timestamp };
          }
        }
        let state: "idle" | "running" | "stalled" | "stopped" | "complete" = "idle";
        const progressTimestamp = progress?.timestamp ?? 0;
        if (stopTimestamp >= Math.max(startTimestamp, progressTimestamp)) state = "stopped";
        else if (terminal && terminal.timestamp >= Math.max(startTimestamp, progressTimestamp)) state = terminal.state;
        else if (startTimestamp > progressTimestamp) {
          state = Date.now() - startTimestamp < 30_000 ? "running" : "stalled";
        } else if (progress) {
          if (progress.percent >= 100 || progress.done >= progress.total) state = "complete";
          else if (Date.now() - progress.timestamp < 30_000) state = "running";
          else state = "stalled";
        }
        return Response.json(
          { data: { state, ...(progress || {}) } },
          { headers: { "cache-control": "no-store" } },
        );
      } finally {
        await handle.close();
      }
    } catch (error) {
      return Response.json(
        { message: error instanceof Error ? error.message : "visitmap status unavailable" },
        { status: 503 },
      );
    }
  }
  if (path === "regions-live") {
    try {
      const files = await readdir("/7dtd-save/Region", { withFileTypes: true });
      const regions = files
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const match = /^r\.(-?\d+)\.(-?\d+)\.7rg$/i.exec(entry.name);
          return match
            ? { name: entry.name, x: Number(match[1]), z: Number(match[2]) }
            : null;
        })
        .filter((region): region is { name: string; x: number; z: number } => Boolean(region));
      return Response.json(
        { data: { regions } },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      return Response.json(
        { message: error instanceof Error ? error.message : "Regions unavailable" },
        { status: 503 },
      );
    }
  }
  if (path === "entities-live") {
    const me = (await auth.json().catch(() => null)) as AuthProfile | null;
    const orgId = me?.orgs?.[0]?.orgId;
    if (!orgId) {
      return Response.json(
        { message: "Organization required" },
        { status: 503 },
      );
    }
    const response = await fetch(
      `${control}/api/orgs/${orgId}/allocs/entities`,
      {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        redirect: "error",
      },
    ).catch(() => null);
    if (!response) {
      return Response.json(
        { message: "Live entities unavailable" },
        { status: 503 },
      );
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return Response.json(
        {
          message:
            (body as { message?: string }).message ||
            "Live entities unavailable",
        },
        { status: response.status },
      );
    }
    return Response.json(
      { data: body },
      { headers: { "cache-control": "no-store" } },
    );
  }
  const tile = path.match(/^map\/(\d+)\/(-?\d+)\/(-?\d+)\.png$/);
  if (tile) {
    const zoom = Number(tile[1]),
      x = Number(tile[2]),
      gameY = -Number(tile[3]) - 1;
    if (
      !Number.isInteger(zoom) ||
      zoom < 0 ||
      zoom > 8 ||
      !Number.isInteger(x) ||
      !Number.isInteger(gameY)
    )
      return Response.json({ message: "Invalid map tile" }, { status: 400 });
    const root = "/7dtd-map";
    const file = pathModule.join(root, String(zoom), String(x), `${gameY}.png`);
    if (!file.startsWith(root + pathModule.sep))
      return Response.json({ message: "Invalid map tile" }, { status: 400 });
    try {
      return new Response(await readFile(file), {
        headers: {
          "content-type": "image/png",
          // Terrain tiles contain no player/entity data and change only when
          // visitmap regenerates them. Let browsers and the edge reuse them.
          "cache-control":
            "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  }
  const base = (
    process.env.SEVENDTD_WEB_URL || "http://host.docker.internal:8080"
  ).replace(/\/$/, "");
  const upstream = await fetch(`${base}/${path}${request.nextUrl.search}`, {
    cache: "no-store",
  }).catch(() => null);
  if (path === "api/map/config" && !upstream?.ok) {
    return Response.json(
      { data: await offlineMapConfig() },
      { headers: { "cache-control": "no-store" } },
    );
  }
  if (!upstream)
    return Response.json(
      { message: "7DTD web map is unavailable" },
      { status: 503 },
    );
  const output = new Headers(upstream.headers);
  output.delete("set-cookie");
  output.delete("content-length");
  output.set(
    "cache-control",
    path.startsWith("map/") ? "private, max-age=30" : "no-store",
  );
  return new Response(upstream.body, {
    status: upstream.status,
    headers: output,
  });
}
