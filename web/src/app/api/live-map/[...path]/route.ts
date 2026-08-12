import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import pathModule from "path";
import net from "net";
export const dynamic = "force-dynamic";
const allowed =
  /^(entities-live|claims-live|api\/(map\/config|serverstats)|map\/\d+\/-?\d+\/-?\d+\.png)$/;
type LiveEntity = {
  id: number;
  name: string;
  type: string;
  position: { x: number; y: number; z: number };
};
async function liveEntities() {
  return new Promise<LiveEntity[]>((resolve, reject) => {
    const socket = net.createConnection({
      host: process.env.SEVENDTD_TELNET_HOST || "host.docker.internal",
      port: Number(process.env.SEVENDTD_TELNET_PORT || 18081),
    });
    let output = "",
      done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      const entities: LiveEntity[] = [];
      const pattern =
        /^\d+\. id=(\d+), \[type=([^,\]]+), name=([^,\]]+).*?\], pos=\((-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\).*?dead=(True|False)/gm;
      let match;
      while ((match = pattern.exec(output))) {
        if (match[7] === "True") continue;
        entities.push({
          id: Number(match[1]),
          type: match[2],
          name: match[3],
          position: {
            x: Number(match[4]),
            y: Number(match[5]),
            z: Number(match[6]),
          },
        });
      }
      resolve(entities);
    };
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("entity query timed out"));
    }, 7000);
    socket.setEncoding("utf8");
    socket.on("connect", () => setTimeout(() => socket.write("le\n"), 500));
    socket.on("data", (chunk) => {
      output += chunk;
      if (/Total of \d+ in the game/.test(output)) finish();
    });
    socket.on("error", (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}
export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } },
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
  const path = (params.path || []).join("/");
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
  if (path === "entities-live") {
    try {
      const all = await liveEntities();
      return Response.json(
        {
          data: {
            players: all.filter((e) => e.type === "EntityPlayer"),
            animals: all.filter((e) => /Animal/i.test(e.type)),
            hostiles: all.filter((e) => /Zombie|Enemy|Vulture/i.test(e.type)),
          },
        },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      return Response.json(
        {
          message:
            error instanceof Error
              ? error.message
              : "Live entities unavailable",
        },
        { status: 503 },
      );
    }
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
          "cache-control": "private, max-age=30",
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
