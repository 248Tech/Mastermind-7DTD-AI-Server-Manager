"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  LayersControl,
  LayerGroup,
  Rectangle,
  Tooltip,
  Polyline,
  Polygon,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { api, PlayerRecord, ServerInstance } from "../../../lib/api";
import { getStoredOrgId } from "../../../lib/auth";
type Entity = {
  id: string | number;
  name: string;
  position: { x: number; y: number; z: number };
};
type Config = {
  enabled: boolean;
  mapBlockSize?: number;
  maxZoom?: number;
  mapSize: { x: number; y: number; z: number };
};
type Snapshot = {
  at: number;
  players: Entity[];
  animals: Entity[];
  hostiles: Entity[];
};
type Claim = {
  id: string;
  owner: string;
  eosId: string;
  steamId: string;
  position: { x: number; y: number; z: number };
  size: number;
};
type PrismaMarker = {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  extra?: string;
};
type PrismaHome = {
  id: string;
  owner: string;
  steamId: string;
  position: { x: number; y: number; z: number };
  active: boolean;
};
type PrismaPoi = {
  id: string;
  name: string;
  x: number;
  z: number;
  minx: number;
  maxx: number;
  minz: number;
  maxz: number;
  containsBed: boolean;
};
type PrismaRect = {
  id: string;
  name: string;
  type: string;
  e: number;
  w: number;
  n: number;
  s: number;
};
type Region = { name: string; x: number; z: number };
type WorldInfo = {
  width: number;
  height: number;
  gameVersion?: string;
  seed?: string;
  source: string;
};
type VisitMapStatus = {
  state: "idle" | "running" | "stalled" | "stopped" | "complete";
  percent?: number;
  done?: number;
  total?: number;
  estimatedSeconds?: number | null;
  at?: string;
};
const HISTORY_KEY = "mm_live_map_history_v1",
  HISTORY_RETENTION_MS = 72 * 60 * 60 * 1000,
  MAX_HISTORY = 25_920,
  MAX_TRAIL_POINTS = 2_000;

function sampleTrail(points: [number, number][]) {
  if (points.length <= MAX_TRAIL_POINTS) return points;
  const last = points.length - 1;
  return Array.from({ length: MAX_TRAIL_POINTS }, (_, index) =>
    points[Math.round((index * last) / (MAX_TRAIL_POINTS - 1))],
  );
}
function playerTrackKey(player: Entity) {
  return String(player.id ?? player.name).trim() || player.name;
}
function poiBounds(poi: PrismaPoi): [[number, number], [number, number]] {
  const halfX = Math.floor(Math.abs(poi.minx - poi.maxx) / 2);
  const halfZ = Math.floor(Math.abs(poi.minz - poi.maxz) / 2);
  return [
    [poi.x - halfX, poi.z - halfZ],
    [poi.x + halfX, poi.z + halfZ],
  ];
}
function rectPolygon(rect: PrismaRect): [number, number][] {
  return [
    [rect.e, rect.s],
    [rect.w, rect.s],
    [rect.w, rect.n],
    [rect.e, rect.n],
  ];
}
const dot = (color: string) =>
  L.divIcon({
    className: "",
    html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px #000"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
function Coordinates() {
  const [text, setText] = useState("Move or click for coordinates");
  useMapEvents({
    mousemove: (e) =>
      setText(`${Math.floor(e.latlng.lat)} E / ${Math.floor(e.latlng.lng)} N`),
    click: (e) =>
      setText(
        `Pinned: ${Math.floor(e.latlng.lat)} E / ${Math.floor(e.latlng.lng)} N`,
      ),
  });
  return (
    <div
      style={{
        position: "absolute",
        zIndex: 1000,
        left: 10,
        bottom: 10,
        background: "rgba(15,23,42,.9)",
        color: "#e2e8f0",
        padding: "6px 9px",
        borderRadius: 5,
        fontSize: 12,
      }}
    >
      {text}
    </div>
  );
}
function MapViewportControls({ bounds }: { bounds: L.LatLngBounds }) {
  const map = useMap();
  return (
    <div className="map-viewport-controls">
      <button type="button" onClick={() => map.fitBounds(bounds, { padding: [18, 18] })}>Fit world</button>
      <button type="button" onClick={() => map.setZoom(Math.max(map.getMinZoom(), 0))}>Reset zoom</button>
    </div>
  );
}
function MapLegend({ prismaConfigured }: { prismaConfigured: boolean }) {
  const items = [
    ["#3b82f6", "Players"],
    ["#22c55e", "Animals"],
    ["#ef4444", "Hostiles"],
    ["#a855f7", "Land claims"],
    ...(prismaConfigured ? [["#eab308", "POIs"], ["#38bdf8", "Vehicles"]] : []),
  ];
  return (
    <div className="map-legend" aria-label="Map legend">
      <strong>Legend</strong>
      {items.map(([color, label]) => (
        <span key={label}><i style={{ background: color }} />{label}</span>
      ))}
    </div>
  );
}
function formatAge(at: number | null) {
  if (!at) return "Waiting for first update";
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  return seconds < 5 ? "Updated just now" : `Updated ${seconds}s ago`;
}
export default function LiveMapClient() {
  const orgId = getStoredOrgId();
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [feedError, setFeedError] = useState(""),
    [lastLiveUpdate, setLastLiveUpdate] = useState<number | null>(null),
    [config, setConfig] = useState<Config | null>(null),
    [players, setPlayers] = useState<Entity[]>([]),
    [animals, setAnimals] = useState<Entity[]>([]),
    [hostiles, setHostiles] = useState<Entity[]>([]),
    [claims, setClaims] = useState<Claim[]>([]),
    [regionFiles, setRegionFiles] = useState<Region[]>([]),
    [worldInfo, setWorldInfo] = useState<WorldInfo | null>(null),
    [gameTime, setGameTime] = useState(""),
    [history, setHistory] = useState<Snapshot[]>([]),
    [historyCursorAt, setHistoryCursorAt] = useState<number | null>(null),
    [historyWindow, setHistoryWindow] = useState(120),
    [trackedPlayer, setTrackedPlayer] = useState(""),
    [trackingColor, setTrackingColor] = useState("#ff2bd6"),
    [showAllPlayerTrails, setShowAllPlayerTrails] = useState(false),
    [showClaims, setShowClaims] = useState(true),
    [showPlayerNames, setShowPlayerNames] = useState(true),
    [showLogoutLocations, setShowLogoutLocations] = useState(false),
    [prismaConfigured, setPrismaConfigured] = useState(false),
    [vehicles, setVehicles] = useState<PrismaMarker[]>([]),
    [drones, setDrones] = useState<PrismaMarker[]>([]),
    [traders, setTraders] = useState<PrismaMarker[]>([]),
    [homes, setHomes] = useState<PrismaHome[]>([]),
    [questPois, setQuestPois] = useState<PrismaPoi[]>([]),
    [allPois, setAllPois] = useState<PrismaPoi[]>([]),
    [poiSearch, setPoiSearch] = useState(""),
    [resetRegions, setResetRegions] = useState<PrismaRect[]>([]),
    [advClaims, setAdvClaims] = useState<PrismaRect[]>([]),
    [showAllPois, setShowAllPois] = useState(false),
    [advClaimFilter, setAdvClaimFilter] = useState("all"),
    [logoutMarkers, setLogoutMarkers] = useState<Array<{ id: string; name: string; x: number; y: number | null; z: number; lastLogoutAt: string | null }>>([]),
    [server, setServer] = useState<ServerInstance | null>(null),
    [visitBusy, setVisitBusy] = useState(false),
    [visitNotice, setVisitNotice] = useState(""),
    [visitStatus, setVisitStatus] = useState<VisitMapStatus>({ state: "idle" }),
    [visitSection, setVisitSection] = useState(0);
  const prismaConfiguredRef = useRef(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      if (Array.isArray(saved))
        setHistory(
          saved
            .filter((x) => x?.at > Date.now() - HISTORY_RETENTION_MS)
            .slice(-MAX_HISTORY),
        );
    } catch {
      /* Ignore damaged browser history. */
    }
  }, []);
  useEffect(() => {
    const token = localStorage.getItem("mm_token");
    if (!token) {
      setError("Sign in again to open the map.");
      return;
    }
    fetch("/api/live-map-session", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error("Could not authorize Live Map");
        setReady(true);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const get = async (path: string) => {
      const r = await fetch(`/api/live-map/${path}`, { cache: "no-store" });
      const body = await r.json();
      if (!r.ok)
        throw new Error(body.message || `Map API returned ${r.status}`);
      return body.data ?? body;
    };
    const loadConfig = () =>
      get("api/map/config")
        .then((v) => active && setConfig(v))
        .catch((e) => active && setError(e.message));
    const loadWorldInfo = () =>
      get("world-info")
        .then((value) => active && setWorldInfo(value))
        .catch(() => undefined);
    const update = () => {
      void get("entities-live")
        .then((e) => {
          if (!active) return;
          const next = {
            at: Date.now(),
            players: e.players ?? [],
            animals: e.animals ?? [],
            hostiles: e.hostiles ?? [],
          };
          setPlayers(next.players);
          setAnimals(next.animals);
          setHostiles(next.hostiles);
          setLastLiveUpdate(next.at);
          setHistory((old) => {
            const updated = [...old, next]
              .filter((x) => x.at > Date.now() - HISTORY_RETENTION_MS)
              .slice(-MAX_HISTORY);
            try {
              localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
            } catch {
              /* Storage full: map stays functional. */
            }
            return updated;
          });
          const errors = (e.errors || {}) as Record<string, string>;
          setFeedError(
            [errors.players, errors.hostiles, errors.animals]
              .filter(Boolean)
              .join(" · ") || "",
          );
        })
        .catch((e) => active && setFeedError(e.message));
      void get("claims-live")
        .then((c) => {
          if (!active || prismaConfiguredRef.current) return;
          setClaims(c.claims ?? []);
        })
        .catch((e) => active && !prismaConfiguredRef.current && setFeedError(`Claims: ${e.message}`));
      void get("regions-live")
        .then((r) => active && setRegionFiles(r.regions ?? []))
        .catch((e) => active && setFeedError(`Regions: ${e.message}`));
      void get("api/serverstats")
        .then((s) => {
          if (!active) return;
          const t = s.gameTime;
          setGameTime(
            t
              ? `Day ${t.days}, ${String(t.hours).padStart(2, "0")}:${String(t.minutes).padStart(2, "0")}`
              : "",
          );
        })
        .catch(() => undefined);
      void get("visitmap-status")
        .then((status) => active && setVisitStatus(status))
        .catch(() => undefined);
    };
    loadConfig();
    loadWorldInfo();
    update();
    const timer = setInterval(update, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [ready]);
  useEffect(() => {
    if (!ready || !orgId) return;
    api
      .get<ServerInstance[]>(`/api/orgs/${orgId}/server-instances`)
      .then((servers) =>
        setServer(servers.find((candidate) => candidate.gameType === "7dtd") ?? null),
      )
      .catch(() => setVisitNotice("Could not find the registered 7DTD server."));
  }, [ready, orgId]);
  useEffect(() => {
    if (!ready || !orgId) return;
    let active = true;
    const loadPrisma = async () => {
      try {
        const status = await api.get<{ configured?: boolean; reachable?: boolean }>(
          `/api/orgs/${orgId}/prismacore/status`,
        );
        if (!active) return;
        const configured = Boolean(status.configured);
        prismaConfiguredRef.current = configured;
        setPrismaConfigured(configured);
        if (!configured) return;
        const [land, vehicleRows, droneRows, traderRows, homeRows, questRows, resetRows, advRows, allPoiRows] =
          await Promise.all([
            api.get<{ reachable?: boolean; claims?: Claim[] }>(`/api/orgs/${orgId}/prismacore/landclaims`),
            api.get<{ markers?: PrismaMarker[] }>(`/api/orgs/${orgId}/prismacore/vehicles`),
            api.get<{ markers?: PrismaMarker[] }>(`/api/orgs/${orgId}/prismacore/drones`),
            api.get<{ markers?: PrismaMarker[] }>(`/api/orgs/${orgId}/prismacore/traders`),
            api.get<{ homes?: PrismaHome[] }>(`/api/orgs/${orgId}/prismacore/playerhomes`),
            api.get<{ pois?: PrismaPoi[] }>(`/api/orgs/${orgId}/prismacore/questpois`),
            api.get<{ regions?: PrismaRect[] }>(`/api/orgs/${orgId}/prismacore/resetregions`),
            api.get<{ claims?: PrismaRect[] }>(`/api/orgs/${orgId}/prismacore/advclaims`),
            showAllPois
              ? api.get<{ pois?: PrismaPoi[] }>(`/api/orgs/${orgId}/prismacore/allpois`)
              : Promise.resolve({ pois: [] as PrismaPoi[] }),
          ]);
        if (!active) return;
        if (land.reachable) setClaims(land.claims ?? []);
        setVehicles(vehicleRows.markers ?? []);
        setDrones(droneRows.markers ?? []);
        setTraders(traderRows.markers ?? []);
        setHomes(homeRows.homes ?? []);
        setQuestPois(questRows.pois ?? []);
        setResetRegions(resetRows.regions ?? []);
        setAdvClaims(advRows.claims ?? []);
        if (showAllPois) setAllPois(allPoiRows.pois ?? []);
      } catch {
        if (!active) return;
        prismaConfiguredRef.current = false;
        setPrismaConfigured(false);
      }
    };
    void loadPrisma();
    const timer = setInterval(() => void loadPrisma(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [ready, orgId, showAllPois]);
  useEffect(() => {
    if (!ready || !orgId || !server || !showLogoutLocations) {
      if (!showLogoutLocations) setLogoutMarkers([]);
      return;
    }
    let active = true;
    const load = () =>
      api
        .get<PlayerRecord[]>(`/api/orgs/${orgId}/players?serverInstanceId=${encodeURIComponent(server.id)}`)
        .then((rows) => {
          if (!active) return;
          setLogoutMarkers(
            rows
              .filter((player) => !player.online && player.lastPosX != null && player.lastPosZ != null)
              .map((player) => ({
                id: player.id,
                name: player.name,
                x: player.lastPosX as number,
                y: player.lastPosY,
                z: player.lastPosZ as number,
                lastLogoutAt: player.lastLogoutAt,
              })),
          );
        })
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [ready, orgId, server, showLogoutLocations]);
  // Keep CRS identity stable across polling/history renders. Leaflet treats a
  // changed CRS as a viewport reset, which can look like random zooming.
  const divisor = 2 ** (config?.maxZoom ?? 4);
  const crs = useMemo(() => L.extend({}, L.CRS.Simple, {
    projection: {
      project: (p: L.LatLng) => new L.Point(p.lat / divisor, p.lng / divisor),
      unproject: (p: L.Point) => new L.LatLng(p.x * divisor, p.y * divisor),
      bounds: L.bounds([-Infinity, -Infinity], [Infinity, Infinity]),
    },
    transformation: new L.Transformation(1, 0, -1, 0),
    scale: (zoom: number) => 2 ** zoom,
  }) as L.CRS, [divisor]);

  async function sendVisitCommand(command: string, successMessage: string) {
    if (!orgId || !server || visitBusy) return;
    setVisitBusy(true);
    setVisitNotice("");
    try {
      await api.post<{ ok: boolean; command: string; result?: string }>(
        `/api/orgs/${orgId}/allocs/console`,
        { command },
      );
      if (command.startsWith("visitmap ") && command !== "visitmap stop") {
        setVisitStatus({ state: "running", percent: 0 });
      }
      setVisitNotice(successMessage);
    } catch (commandError) {
      setVisitNotice(
        commandError instanceof Error ? commandError.message : "visitmap command failed.",
      );
    } finally {
      setVisitBusy(false);
    }
  }

  async function stopVisitMap() {
    await sendVisitCommand("visitmap stop", "Stop command delivered; verifying server progress…");
    window.setTimeout(async () => {
      try {
        const response = await fetch("/api/live-map/visitmap-status", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || "Status unavailable");
        const status = (body.data ?? body) as VisitMapStatus;
        setVisitStatus(status);
        setVisitNotice(
          status.state === "stopped" || status.state === "idle" || status.state === "complete"
            ? "Map generation is not running."
            : status.state === "stalled"
              ? "Stop was sent, but the stalled game thread has not processed it. A server restart may be required."
              : "Stop was sent, but map generation is still reporting progress.",
        );
      } catch (statusError) {
        setVisitNotice(statusError instanceof Error ? statusError.message : "Could not verify visitmap status.");
      }
    }, 3500);
  }
  if (error)
    return (
      <div>
        <h1>Live Server Map</h1>
        <div
          style={{
            padding: "1rem",
            background: "#3f1d25",
            color: "#fca5a5",
            borderRadius: 8,
          }}
        >
          {error}
        </div>
      </div>
    );
  if (!config)
    return (
      <div>
        <h1>Live Server Map</h1>
        <p style={{ color: "#64748b" }}>Connecting to the 7DTD map renderer…</p>
      </div>
    );
  if (!config.enabled)
    return (
      <div>
        <h1>Live Server Map</h1>
        <p style={{ color: "#fbbf24" }}>
          Map rendering is disabled in serverconfig.xml. Enable it and restart
          7DTD.
        </p>
      </div>
    );
  const size = config.mapSize || { x: 8192, y: 255, z: 8192 };
  const visitWidth = Math.floor(worldInfo?.width || size.x);
  const visitHeight = Math.floor(worldInfo?.height || size.z);
  const worldX1 = -Math.floor(visitWidth / 2);
  const worldZ1 = -Math.floor(visitHeight / 2);
  const worldX2 = worldX1 + visitWidth - 1;
  const worldZ2 = worldZ1 + visitHeight - 1;
  const sectionColumn = visitSection % 4;
  const sectionRow = Math.floor(visitSection / 4);
  const sectionWidth = Math.ceil(visitWidth / 4);
  const sectionHeight = Math.ceil(visitHeight / 4);
  const visitX1 = worldX1 + sectionColumn * sectionWidth;
  const visitX2 = Math.min(worldX2, visitX1 + sectionWidth - 1);
  const visitZ2 = worldZ2 - sectionRow * sectionHeight;
  const visitZ1 = Math.max(worldZ1, visitZ2 - sectionHeight + 1);
  const visitCommand = `visitmap ${visitX1} ${visitZ1} ${visitX2} ${visitZ2}`;
  const fullVisitCommand = `visitmap ${worldX1} ${worldZ1} ${worldX2} ${worldZ2}`;
  const visitRunning = visitStatus.state === "running" || visitStatus.state === "stalled";
  const visitBlocked = players.length > 0 || visitRunning;
  const regionDefinitions = regionFiles.length
    ? regionFiles
    : Array.from(
        { length: Math.ceil(size.x / 512) * Math.ceil(size.z / 512) },
        (_, index) => {
          const width = Math.ceil(size.z / 512);
          const x = Math.floor(-size.x / 1024) + Math.floor(index / width);
          const z = Math.floor(-size.z / 1024) + (index % width);
          return { name: `r.${x}.${z}.7rg`, x, z };
        },
      );
  const regions = regionDefinitions.map((region) => {
    const x0 = region.x * 512,
      z0 = region.z * 512;
    return (
      <Rectangle
        key={region.name}
        bounds={[
          [x0, z0],
          [x0 + 512, z0 + 512],
        ]}
        pathOptions={{ color: "#94a3b8", weight: 1, fill: false }}
      >
        <Tooltip
          permanent
          direction="center"
          opacity={0.9}
          interactive={false}
          className="region-grid-label"
        >
          {region.name}
        </Tooltip>
      </Rectangle>
    );
  });
  const mapBounds = L.latLngBounds([worldX1, worldZ1], [worldX2, worldZ2]);
  const windowedHistory = history.filter(
    (snapshot) => snapshot.at >= Date.now() - historyWindow * 60_000,
  );
  const historyStart = windowedHistory[0]?.at;
  const historyEnd = windowedHistory[windowedHistory.length - 1]?.at;
  const viewed =
    historyCursorAt === null
      ? { at: Date.now(), players, animals, hostiles }
      : windowedHistory.find((snapshot) => snapshot.at === historyCursorAt) ||
        windowedHistory.filter((snapshot) => snapshot.at <= historyCursorAt).slice(-1)[0] ||
        { at: Date.now(), players, animals, hostiles };
  const visibleAdvClaims = advClaimFilter === "all" ? advClaims : advClaims.filter((claim) => claim.type === advClaimFilter);
  const normalizedPoiSearch = poiSearch.trim().toLocaleLowerCase();
  const matchesPoiSearch = (poi: PrismaPoi) => !normalizedPoiSearch || poi.name.toLocaleLowerCase().includes(normalizedPoiSearch);
  const visibleQuestPois = questPois.filter(matchesPoiSearch);
  const visibleAllPois = allPois.filter(matchesPoiSearch);
  const playerChoices = [
    ...new Map(
      history
        .flatMap((s) => s.players)
        .concat(players)
        .map((p) => [playerTrackKey(p), p]),
    ).values(),
  ];
  // Local history can be restored out of order. Include the newest live poll
  // so trails do not lag one refresh behind the player marker.
  const liveSnapshot: Snapshot = { at: Date.now(), players, animals, hostiles };
  const trailHistory = [
    ...(historyCursorAt === null ? windowedHistory : windowedHistory.filter((snapshot) => snapshot.at <= historyCursorAt)),
    ...(historyCursorAt === null && players.length ? [liveSnapshot] : []),
  ].sort((a, b) => a.at - b.at);
  const visibleIds = showAllPlayerTrails
    ? [...new Set(trailHistory.flatMap((s) => s.players.map(playerTrackKey)))]
    : trackedPlayer
      ? [trackedPlayer]
      : [...new Set(viewed.players.map(playerTrackKey))];
  const trails = visibleIds
    .map((id) => {
      const points = trailHistory
        .flatMap((s) =>
          s.players
            .filter((p) => playerTrackKey(p) === id)
            .filter((p) => Number.isFinite(p.position?.x) && Number.isFinite(p.position?.z))
            .map((p) => [p.position.x, p.position.z] as [number, number]),
        );
      const distinct = points.filter((point, index) => index === 0 || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1]);
      return { id, points: sampleTrail(distinct) };
    })
    .filter((trail) => trail.points.length > 1);
  return (
    <div className="live-map-page">
      <style jsx global>{`
        .live-map-page { color: #e2e8f0; }
        .map-heading { background: linear-gradient(135deg, rgba(30,41,59,.72), rgba(15,23,42,.42)); border: 1px solid #273449; border-radius: 12px; padding: 16px 18px; }
        .map-stats { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 12px; }
        .map-stat { border: 1px solid #334155; border-radius: 999px; padding: 4px 9px; background: rgba(15,23,42,.7); font-size: 12px; }
        .map-toolbar { margin: 10px 0; padding: 10px; background: #111118; border: 1px solid #252532; border-radius: 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .map-toolbar .toolbar-group { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-right: 8px; margin-right: 2px; border-right: 1px solid #293241; }
        .map-toolbar .toolbar-group:last-child { border-right: 0; }
        .map-filter-details { border-right: 1px solid #293241; }
        .map-filter-details summary { cursor: pointer; color: #cbd5e1; font-size: 12px; font-weight: 600; padding: 6px 8px; border: 1px solid #334155; border-radius: 6px; list-style-position: inside; white-space: nowrap; }
        .map-filter-details[open] summary { border-radius: 6px 6px 0 0; }
        .map-filter-details .filter-detail-content { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 8px 2px 0; }
        .map-toolbar select, .map-toolbar button { min-height: 32px; }
        .map-toolbar button:focus-visible, .map-toolbar select:focus-visible, .map-toolbar input:focus-visible, .map-heading button:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
        .map-maintenance { min-width: min(100%, 320px); }
        .map-maintenance summary { cursor: pointer; color: #fbbf24; font-size: 12px; font-weight: 600; padding: 6px 8px; border: 1px solid #3f3f46; border-radius: 6px; background: rgba(120,53,15,.2); list-style-position: inside; }
        .map-maintenance[open] summary { border-radius: 6px 6px 0 0; }
        .map-maintenance > div { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; padding-top: 8px; }
        .leaflet-control-layers { border: 1px solid #475569 !important; border-radius: 8px !important; background: rgba(15,23,42,.94) !important; color: #e2e8f0 !important; box-shadow: 0 3px 12px rgba(0,0,0,.3) !important; }
        .leaflet-control-layers-toggle { width: 40px !important; height: 40px !important; background-color: #0f172a !important; border-radius: 7px; }
        .leaflet-control-layers-expanded { padding: 9px 10px !important; line-height: 1.8 !important; }
        .leaflet-control-layers label { margin: 2px 0; }
        .map-frame { height: calc(100vh - 230px); min-height: 520px; border: 1px solid #334155; border-radius: 12px; overflow: hidden; box-shadow: 0 14px 35px rgba(0,0,0,.22); }
        .map-empty-state { position: absolute; z-index: 900; top: 12px; left: 50%; transform: translateX(-50%); max-width: calc(100% - 24px); padding: 7px 11px; border: 1px solid #475569; border-radius: 7px; background: rgba(15,23,42,.9); color: #cbd5e1; font-size: 12px; text-align: center; pointer-events: none; }
        .map-viewport-controls { position: absolute; z-index: 1000; top: 10px; left: 10px; display: flex; gap: 5px; }
        .map-viewport-controls button { border: 1px solid #475569; border-radius: 6px; background: rgba(15,23,42,.92); color: #e2e8f0; padding: 6px 8px; font-size: 11px; cursor: pointer; }
        .map-viewport-controls button:hover { background: #1e293b; }
        .map-legend { position: absolute; z-index: 1000; right: 10px; bottom: 10px; display: flex; flex-wrap: wrap; gap: 7px 10px; max-width: min(420px, calc(100% - 20px)); padding: 7px 9px; border: 1px solid #475569; border-radius: 7px; background: rgba(15,23,42,.92); color: #cbd5e1; font-size: 11px; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
        .map-legend strong { color: #f8fafc; margin-right: 2px; }
        .map-legend span { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
        .map-legend i { width: 8px; height: 8px; display: inline-block; border-radius: 50%; border: 1px solid rgba(255,255,255,.7); }
        @media (max-width: 700px) {
          .map-heading { padding: 12px; }
          .map-toolbar .toolbar-group { width: 100%; border-right: 0; border-bottom: 1px solid #293241; padding: 0 0 8px; }
          .map-toolbar .toolbar-group:last-child { border-bottom: 0; padding-bottom: 0; }
          .map-frame { height: calc(100vh - 290px); min-height: 430px; }
        }
      `}</style>
      <div
        className="map-heading"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "end",
          marginBottom: 8,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Live Server Map</h1>
          <p style={{ color: "#64748b", margin: ".25rem 0 0" }}>
            Terrain and entities refresh every 10 seconds. Inspired by CSMM;
            powered by live 7DTD data.
          </p>
          {worldInfo && (
            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 5 }}>
              World size: <strong style={{ color: "#e2e8f0" }}>{worldInfo.width.toLocaleString()} × {worldInfo.height.toLocaleString()} blocks</strong>
              <span style={{ color: "#64748b" }}> · read from {worldInfo.source}</span>
            </div>
          )}
          <div className="map-stats">
            <span className="map-stat" style={{ color: "#60a5fa" }}>
              Players {viewed.players.length}
            </span>
            <span className="map-stat" style={{ color: "#4ade80" }}>
              Animals {viewed.animals.length}
            </span>
            <span className="map-stat" style={{ color: "#f87171" }}>
              Hostiles {viewed.hostiles.length}
            </span>
            <span className="map-stat" style={{ color: "#c084fc" }}>Claims {claims.length}</span>
            {prismaConfigured && (
              <>
                <span className="map-stat" style={{ color: "#38bdf8" }}>Vehicles {vehicles.length}</span>
                <span className="map-stat" style={{ color: "#f472b6" }}>Drones {drones.length}</span>
                <span className="map-stat" style={{ color: "#facc15" }}>Traders {traders.length}</span>
              </>
            )}
            {feedError && (
              <span style={{ color: "#fbbf24" }}>Feed error: {feedError}</span>
            )}
            {!feedError && <span className="map-stat" role="status" style={{ color: lastLiveUpdate ? "#4ade80" : "#fbbf24" }}>{formatAge(lastLiveUpdate)}</span>}
          </div>
        </div>
        <details className="map-maintenance">
          <summary>{gameTime || "Map maintenance"} · {visitRunning ? `generation ${visitStatus.state}` : "generation idle"}</summary>
          <div>
          <select
            aria-label="Map generation section"
            value={visitSection}
            disabled={visitBusy || visitRunning}
            onChange={(event) => setVisitSection(Number(event.target.value))}
            style={{ background: "#0d0d14", color: "#e2e8f0", border: "1px solid #475569", borderRadius: 6, padding: "7px 9px" }}
          >
            {Array.from({ length: 16 }, (_, index) => {
              const row = Math.floor(index / 4) + 1;
              const column = (index % 4) + 1;
              return <option key={index} value={index}>Section {index + 1}/16 · row {row}, column {column}</option>;
            })}
          </select>
          <button
            disabled={!server || !worldInfo || visitBusy || visitBlocked}
            title={
              players.length > 0
                ? `Maintenance-only operation: ${players.length} player${players.length === 1 ? " is" : "s are"} connected`
                : visitRunning
                  ? `visitmap is ${visitStatus.state}`
                : worldInfo
                  ? visitCommand
                  : "Waiting for map_info.xml"
            }
            onClick={() => {
              if (!worldInfo) return;
              const confirmed = window.confirm(
                `Generate section ${visitSection + 1} of 16 for the ${visitWidth.toLocaleString()} × ${visitHeight.toLocaleString()} world?\n\nCommand: ${visitCommand}\n\nThis section covers ${(visitX2 - visitX1 + 1).toLocaleString()} × ${(visitZ2 - visitZ1 + 1).toLocaleString()} blocks. Run one section at a time during maintenance.`,
              );
              if (confirmed)
                void sendVisitCommand(
                  visitCommand,
                  `Map section ${visitSection + 1}/16 started. Tiles will appear progressively; wait for completion before starting another section.`,
                );
            }}
            style={{
              background: !server || !worldInfo || visitBusy || visitBlocked ? "#334155" : "#b45309",
              color: "white",
              border: 0,
              borderRadius: 6,
              padding: "7px 11px",
              cursor: !server || !worldInfo || visitBusy || visitBlocked ? "not-allowed" : "pointer",
            }}
          >
            {visitBusy
              ? "Sending…"
              : players.length > 0
                ? `Wait for ${players.length} online player${players.length === 1 ? "" : "s"}`
                : visitRunning
                  ? `Map generation ${visitStatus.state}`
                  : `Generate section ${visitSection + 1}/16`}
          </button>
          <button
            disabled={!server || !worldInfo || visitBusy || visitBlocked}
            title={
              players.length > 0
                ? `Maintenance-only operation: ${players.length} player${players.length === 1 ? " is" : "s are"} connected`
                : visitRunning
                  ? `visitmap is ${visitStatus.state}`
                  : worldInfo
                    ? `High-load operation: ${fullVisitCommand}`
                    : "Waiting for map_info.xml"
            }
            onClick={() => {
              if (!worldInfo) return;
              const confirmed = window.confirm(
                `Generate the ENTIRE ${visitWidth.toLocaleString()} × ${visitHeight.toLocaleString()} world in one operation?\n\nCommand: ${fullVisitCommand}\n\nWARNING: This is extremely demanding and previously froze the game server before completion. The server may become unresponsive and require a forced restart. Section generation is strongly recommended.\n\nOnly continue during maintenance when no players are connected.`,
              );
              if (confirmed)
                void sendVisitCommand(
                  fullVisitCommand,
                  "Full-world map generation started. The server may respond slowly; monitor progress below and do not start another generation job.",
                );
            }}
            style={{
              background: !server || !worldInfo || visitBusy || visitBlocked ? "#334155" : "#9f1239",
              color: "white",
              border: "1px solid #fb7185",
              borderRadius: 6,
              padding: "7px 11px",
              cursor: !server || !worldInfo || visitBusy || visitBlocked ? "not-allowed" : "pointer",
            }}
          >
            Generate full map
          </button>
          {visitRunning && (
            <button
              disabled={!server || visitBusy}
              title="Stop the current visitmap operation"
              onClick={() => void stopVisitMap()}
              style={{
                background: !server || visitBusy ? "#334155" : "#7f1d1d",
                color: "white",
                border: 0,
                borderRadius: 6,
                padding: "7px 11px",
                cursor: !server || visitBusy ? "not-allowed" : "pointer",
              }}
            >
              Stop map generation
            </button>
          )}
          </div>
        </details>
      </div>
      <div style={{ color: visitStatus.state === "stalled" ? "#fca5a5" : visitStatus.state === "running" ? "#fbbf24" : "#94a3b8", fontSize: 12, marginBottom: 8 }}>
        visitmap: <strong>{visitStatus.state}</strong>
        {visitStatus.total ? ` · ${visitStatus.percent ?? 0}% · ${(visitStatus.done ?? 0).toLocaleString()} / ${visitStatus.total.toLocaleString()} chunks` : ""}
        {visitStatus.estimatedSeconds ? ` · about ${Math.ceil(visitStatus.estimatedSeconds / 60)} minutes remaining` : ""}
      </div>
      {visitNotice && (
        <div style={{ color: /failed|could not|did not/i.test(visitNotice) ? "#fca5a5" : "#fbbf24", fontSize: 12, marginBottom: 8 }}>
          {visitNotice}
        </div>
      )}
      <div
        className="map-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
          marginBottom: 8,
          background: "#111118",
          border: "1px solid #252532",
          borderRadius: 8,
          flexWrap: "wrap",
        }}
      >
          <div className="toolbar-group">
          <select
          aria-label="Track player"
          value={trackedPlayer}
          onChange={(e) => setTrackedPlayer(e.target.value)}
          style={{
            background: "#0d0d14",
            color: "#e2e8f0",
            border: "1px solid #334155",
            borderRadius: 6,
            padding: "6px 9px",
            maxWidth: 180,
          }}
        >
          <option value="">All players</option>
          {playerChoices.map((p) => (
            <option key={playerTrackKey(p)} value={playerTrackKey(p)}>
              Track: {p.name}
            </option>
          ))}
        </select>
          {trackedPlayer && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: trackingColor, fontSize: 12, whiteSpace: "nowrap" }}>
            Trail color
            <input
              type="color"
              aria-label="Tracked player trail color"
              value={trackingColor}
              onChange={(event) => setTrackingColor(event.target.value)}
              style={{ width: 30, height: 26, padding: 0, border: "1px solid #475569", borderRadius: 5, background: "transparent", cursor: "pointer" }}
            />
          </label>
          )}
          </div>
          <div className="toolbar-group">
            <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#38bdf8", fontSize: 12, whiteSpace: "nowrap" }}>
              POI search
            </label>
            <input
              aria-label="Search POIs by name"
              placeholder={prismaConfigured ? "Search by name…" : "PrismaCore unavailable"}
              value={poiSearch}
              onChange={(event) => setPoiSearch(event.target.value)}
              disabled={!prismaConfigured}
              title={!prismaConfigured ? "Configure PrismaCore to search POIs" : "Filter POIs by name"}
              style={{ background: "#0d0d14", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: "6px 9px", minWidth: 155, opacity: prismaConfigured ? 1 : 0.65 }}
            />
            {poiSearch && (
              <button type="button" aria-label="Clear POI search" onClick={() => setPoiSearch("")} style={{ background: "#334155", color: "#e2e8f0", border: 0, borderRadius: 6, padding: "6px 9px", cursor: "pointer" }}>Clear</button>
            )}
          </div>
          <details className="toolbar-group map-filter-details">
            <summary>Filters</summary>
            <div className="filter-detail-content">
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: "#60a5fa",
            fontSize: 12,
            whiteSpace: "nowrap",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showAllPlayerTrails}
            onChange={(event) => setShowAllPlayerTrails(event.target.checked)}
            style={{ accentColor: "#3b82f6" }}
          />
          Show all player trails
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: "#60a5fa",
            fontSize: 12,
            whiteSpace: "nowrap",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showPlayerNames}
            onChange={(event) => setShowPlayerNames(event.target.checked)}
            style={{ accentColor: "#3b82f6" }}
          />
          Show player names
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: "#fbbf24",
            fontSize: 12,
            whiteSpace: "nowrap",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showLogoutLocations}
            onChange={(event) => setShowLogoutLocations(event.target.checked)}
            style={{ accentColor: "#f59e0b" }}
          />
          Last reported logout locations ({logoutMarkers.length})
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: "#c084fc",
            fontSize: 12,
            whiteSpace: "nowrap",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showClaims}
            onChange={(event) => setShowClaims(event.target.checked)}
            style={{ accentColor: "#a855f7" }}
          />
          Show land claims ({claims.length})
        </label>
        {prismaConfigured && (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#38bdf8", fontSize: 12, whiteSpace: "nowrap" }}>
              PrismaCore
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#e2e8f0", fontSize: 12, whiteSpace: "nowrap", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showAllPois}
                onChange={(event) => setShowAllPois(event.target.checked)}
                style={{ accentColor: "#eab308" }}
              />
              All POIs ({allPois.length})
            </label>
            <select
              aria-label="Advanced claim type"
              value={advClaimFilter}
              onChange={(event) => setAdvClaimFilter(event.target.value)}
              style={{ background: "#0d0d14", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: "6px 9px" }}
            >
              <option value="all">Adv. claims (all)</option>
              {[...new Set(advClaims.map((claim) => claim.type))].sort().map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </>
        )}
            </div>
          </details>
          <div className="toolbar-group" style={{ flex: 1, minWidth: 260 }}>
        <select
          aria-label="Player history timeframe"
          value={historyWindow}
          onChange={(event) => {
            setHistoryWindow(Number(event.target.value));
            setHistoryCursorAt(null);
          }}
          style={{
            background: "#0d0d14",
            color: "#e2e8f0",
            border: "1px solid #334155",
            borderRadius: 6,
            padding: "6px 9px",
          }}
        >
          <option value={5}>Last 5 minutes</option>
          <option value={15}>Last 15 minutes</option>
          <option value={30}>Last 30 minutes</option>
          <option value={60}>Last 1 hour</option>
          <option value={120}>Last 2 hours</option>
          <option value={360}>Last 6 hours</option>
          <option value={720}>Last 12 hours</option>
          <option value={1440}>Last 24 hours</option>
          <option value={2880}>Last 48 hours</option>
          <option value={4320}>Last 72 hours</option>
        </select>
        <span
          style={{
            fontSize: 12,
            color: historyCursorAt === null ? "#4ade80" : "#fbbf24",
            minWidth: 110,
          }}
        >
          {historyCursorAt === null
            ? "● LIVE"
            : new Date(viewed.at).toLocaleTimeString()}
        </span>
        <input
          aria-label="Map history time"
          type="range"
          min={0}
          max={windowedHistory.length}
          value={historyCursorAt === null ? windowedHistory.length : Math.max(0, windowedHistory.findIndex((snapshot) => snapshot.at === historyCursorAt))}
          onChange={(e) => {
            const n = Number(e.target.value);
            setHistoryCursorAt(n === windowedHistory.length ? null : windowedHistory[n]?.at ?? null);
          }}
          disabled={!windowedHistory.length}
          aria-valuetext={historyCursorAt === null ? "Live" : new Date(viewed.at).toLocaleString()}
          style={{ flex: 1, minWidth: 150, accentColor: "#f59e0b" }}
        />
        <button
          onClick={() => setHistoryCursorAt(null)}
          disabled={historyCursorAt === null}
          style={{
            background: "#2563eb",
            color: "white",
            border: 0,
            borderRadius: 6,
            padding: "6px 12px",
            cursor: "pointer",
          }}
        >
          Live
        </button>
        <span style={{ fontSize: 11, color: "#64748b" }}>
          {windowedHistory.length} points{historyStart && historyEnd ? ` · ${new Date(historyStart).toLocaleTimeString()}–${new Date(historyEnd).toLocaleTimeString()}` : " · no collected data"}
        </span>
        <button
          type="button"
          onClick={() => {
            setTrackedPlayer("");
            setShowAllPlayerTrails(false);
            setShowPlayerNames(true);
            setShowLogoutLocations(false);
            setShowClaims(true);
            setShowAllPois(false);
            setPoiSearch("");
            setAdvClaimFilter("all");
            setHistoryCursorAt(null);
          }}
          style={{ background: "#334155", color: "#e2e8f0", border: 0, borderRadius: 6, padding: "6px 10px", cursor: "pointer", whiteSpace: "nowrap" }}
        >
          Reset filters
        </button>
          </div>
      </div>
      <div
        className="map-frame"
        style={{
          height: "calc(100vh - 230px)",
          minHeight: 520,
          border: "1px solid #252532",
          borderRadius: 9,
          overflow: "hidden",
        }}
      >
        {!feedError && viewed.players.length === 0 && viewed.animals.length === 0 && viewed.hostiles.length === 0 && (
          <div className="map-empty-state" role="status">
            No live entities reported. Other overlays remain available from the layer menu.
          </div>
        )}
        <MapContainer
          center={[0, 0]}
          zoom={1}
          minZoom={-1}
          maxZoom={5}
          maxBounds={mapBounds.pad(0.12)}
          maxBoundsViscosity={1}
          scrollWheelZoom
          wheelDebounceTime={80}
          wheelPxPerZoomLevel={120}
          crs={crs}
          fadeAnimation={false}
          style={{ height: "100%", width: "100%", background: "#111827" }}
        >
          <TileLayer
            url="/api/live-map/map/{z}/{x}/{y}.png"
            tileSize={128}
            minZoom={-1}
            minNativeZoom={0}
            maxNativeZoom={config.maxZoom ?? 4}
            keepBuffer={16}
            updateInterval={50}
            updateWhenIdle={false}
            updateWhenZooming
          />
          <LayersControl position="topright">
            <LayersControl.Overlay name="Players" checked>
              <LayerGroup>
                {trails.map((trail) => {
                  const selected = Boolean(trackedPlayer) && trail.id === trackedPlayer;
                  return (
                  <LayerGroup key={`trail-${trail.id}`}>
                    {selected && <Polyline positions={trail.points} pathOptions={{ color: "#020617", weight: 8, opacity: 0.8 }} />}
                    <Polyline
                      positions={trail.points}
                      pathOptions={{
                        color: selected ? trackingColor : "#60a5fa",
                        weight: selected ? 5 : 2,
                        opacity: selected ? 1 : 0.55,
                      }}
                    />
                  </LayerGroup>
                  );
                })}
                {viewed.players.map((e) => (
                  <Marker
                    key={e.id}
                    position={[e.position.x, e.position.z]}
                    opacity={
                      !trackedPlayer || playerTrackKey(e) === trackedPlayer
                        ? 1
                        : 0.35
                    }
                    icon={dot(
                      playerTrackKey(e) === trackedPlayer ? trackingColor : "#3b82f6",
                    )}
                  >
                    <Popup>
                      {e.name}
                      <br />
                      {Math.round(e.position.x)}, {Math.round(e.position.z)}
                      {playerTrackKey(e) === trackedPlayer && (
                        <>
                          <br />
                          <strong>Tracking</strong>
                        </>
                      )}
                    </Popup>
                    {showPlayerNames && (
                      <Tooltip
                        permanent
                        direction="top"
                        offset={[0, -8]}
                        opacity={1}
                        className="player-map-name"
                      >
                        {e.name}
                      </Tooltip>
                    )}
                  </Marker>
                ))}
              </LayerGroup>
            </LayersControl.Overlay>
            <LayersControl.Overlay name={`Logout locations (${logoutMarkers.length})`} checked>
              <LayerGroup>
                {showLogoutLocations && logoutMarkers.map((marker) => (
                  <Marker
                    key={`logout-${marker.id}`}
                    position={[marker.x, marker.z]}
                    icon={L.divIcon({
                      className: "",
                      html: `<span style="display:block;width:12px;height:12px;border-radius:50%;background:#0f172a;border:2px solid #f59e0b;box-shadow:0 1px 4px #000"></span>`,
                      iconSize: [16, 16],
                      iconAnchor: [8, 8],
                    })}
                  >
                    <Popup>
                      <strong>{marker.name}</strong>
                      <br />
                      Last logout
                      <br />
                      {Math.round(marker.x)}, {Math.round(marker.y ?? 0)}, {Math.round(marker.z)}
                      {marker.lastLogoutAt && (
                        <>
                          <br />
                          {new Date(marker.lastLogoutAt).toLocaleString()}
                        </>
                      )}
                    </Popup>
                    {showPlayerNames && (
                      <Tooltip permanent direction="top" offset={[0, -8]} opacity={1} className="player-map-name">
                        {marker.name} (logout)
                      </Tooltip>
                    )}
                  </Marker>
                ))}
              </LayerGroup>
            </LayersControl.Overlay>
            <LayersControl.Overlay name="Animals" checked>
              <LayerGroup>
                {viewed.animals.map((e) => (
                  <Marker
                    key={e.id}
                    position={[e.position.x, e.position.z]}
                    icon={dot("#22c55e")}
                  >
                    <Popup>{e.name}</Popup>
                  </Marker>
                ))}
              </LayerGroup>
            </LayersControl.Overlay>
            <LayersControl.Overlay name="Hostiles" checked>
              <LayerGroup>
                {viewed.hostiles.map((e) => (
                  <Marker
                    key={e.id}
                    position={[e.position.x, e.position.z]}
                    icon={dot("#ef4444")}
                  >
                    <Popup>{e.name}</Popup>
                  </Marker>
                ))}
              </LayerGroup>
            </LayersControl.Overlay>
            <LayersControl.Overlay name={`Land claims (${claims.length})`} checked>
              <LayerGroup>
                {showClaims && claims.map((claim) => {
                  const half = claim.size / 2;
                  return (
                    <LayerGroup key={claim.id}>
                      <Rectangle
                        bounds={[
                          [claim.position.x - half, claim.position.z - half],
                          [claim.position.x + half, claim.position.z + half],
                        ]}
                        pathOptions={{ color: "#a855f7", weight: 2, fill: true, fillColor: "#7e22ce", fillOpacity: 0.16 }}
                      >
                        <Tooltip sticky>
                          <strong>{claim.owner}</strong><br />Protected {claim.size}×{claim.size}<br />
                          Block: {claim.position.x}, {claim.position.y}, {claim.position.z}<br />
                          Steam: {claim.steamId || "Unavailable"}<br />EOS: {claim.eosId}
                        </Tooltip>
                      </Rectangle>
                      <Marker position={[claim.position.x, claim.position.z]} icon={dot("#a855f7")}>
                        <Popup>
                          <strong>{claim.owner}</strong><br />Land Claim Block<br />
                          {claim.position.x}, {claim.position.y}, {claim.position.z}<br />
                          Protection: {claim.size}×{claim.size}<br />Steam: {claim.steamId || "Unavailable"}<br />EOS: {claim.eosId}
                        </Popup>
                      </Marker>
                    </LayerGroup>
                  );
                })}
              </LayerGroup>
            </LayersControl.Overlay>
            {prismaConfigured && (
              <>
                <LayersControl.Overlay name={`Vehicles (${vehicles.length})`}>
                  <LayerGroup>
                    {vehicles.map((marker) => (
                      <Marker key={marker.id} position={[marker.position.x, marker.position.z]} icon={dot("#38bdf8")}>
                        <Popup>Vehicle: {marker.name}<br />{Math.round(marker.position.x)}, {Math.round(marker.position.y)}, {Math.round(marker.position.z)}</Popup>
                      </Marker>
                    ))}
                  </LayerGroup>
                </LayersControl.Overlay>
                <LayersControl.Overlay name={`Drones (${drones.length})`}>
                  <LayerGroup>
                    {drones.map((marker) => (
                      <Marker key={marker.id} position={[marker.position.x, marker.position.z]} icon={dot("#f472b6")}>
                        <Popup>Drone: {marker.name}<br />{Math.round(marker.position.x)}, {Math.round(marker.position.y)}, {Math.round(marker.position.z)}</Popup>
                      </Marker>
                    ))}
                  </LayerGroup>
                </LayersControl.Overlay>
                <LayersControl.Overlay name={`Beds (${homes.length})`}>
                  <LayerGroup>
                    {homes.map((home) => {
                      const size = 15;
                      return (
                        <LayerGroup key={home.id}>
                          <Rectangle
                            bounds={[
                              [home.position.x - size, home.position.z - size],
                              [home.position.x + size, home.position.z + size],
                            ]}
                            pathOptions={{ color: home.active ? "#4ade80" : "#f87171", weight: 1, fillOpacity: 0.12 }}
                          >
                            <Tooltip sticky>{home.owner || home.steamId}<br />Bed {home.active ? "active" : "inactive"}</Tooltip>
                          </Rectangle>
                          <Marker position={[home.position.x, home.position.z]} icon={dot(home.active ? "#4ade80" : "#f87171")}>
                            <Popup>{home.owner || home.steamId}<br />Bedroll {home.active ? "active" : "inactive"}<br />{home.position.x}, {home.position.y}, {home.position.z}</Popup>
                          </Marker>
                        </LayerGroup>
                      );
                    })}
                  </LayerGroup>
                </LayersControl.Overlay>
                <LayersControl.Overlay name={`Traders (${traders.length})`}>
                  <LayerGroup>
                    {traders.map((marker) => (
                      <Marker key={marker.id} position={[marker.position.x, marker.position.z]} icon={dot("#facc15")}>
                        <Popup>Trader: {marker.name}<br />{Math.round(marker.position.x)}, {Math.round(marker.position.z)}</Popup>
                      </Marker>
                    ))}
                  </LayerGroup>
                </LayersControl.Overlay>
                <LayersControl.Overlay name={`Quest POIs (${visibleQuestPois.length}${normalizedPoiSearch ? `/${questPois.length}` : ""})`}>
                  <LayerGroup>
                    {visibleQuestPois.map((poi) => (
                      <Rectangle key={poi.id} bounds={poiBounds(poi)} pathOptions={{ color: "#ef4444", weight: 1, fillOpacity: 0.12 }}>
                        <Tooltip sticky>{poi.name}<br />{poi.x}, {poi.z}{poi.containsBed ? " · bed/lcb" : ""}</Tooltip>
                      </Rectangle>
                    ))}
                  </LayerGroup>
                </LayersControl.Overlay>
                <LayersControl.Overlay name={`All POIs (${visibleAllPois.length}${normalizedPoiSearch ? `/${allPois.length}` : ""})`}>
                  <LayerGroup>
                    {showAllPois && visibleAllPois.map((poi) => (
                      <Rectangle key={poi.id} bounds={poiBounds(poi)} pathOptions={{ color: "#eab308", weight: 1, fillOpacity: 0.08 }}>
                        <Tooltip sticky>{poi.name}<br />{poi.x}, {poi.z}</Tooltip>
                      </Rectangle>
                    ))}
                  </LayerGroup>
                </LayersControl.Overlay>
                <LayersControl.Overlay name={`Reset regions (${resetRegions.length})`}>
                  <LayerGroup>
                    {resetRegions.map((rect) => (
                      <Polygon key={rect.id} positions={rectPolygon(rect)} pathOptions={{ color: "#ef4444", weight: 1, fillOpacity: 0.12 }}>
                        <Popup>Reset region. Do not build here.</Popup>
                      </Polygon>
                    ))}
                  </LayerGroup>
                </LayersControl.Overlay>
                <LayersControl.Overlay name={`Adv. claims (${visibleAdvClaims.length})`}>
                  <LayerGroup>
                    {visibleAdvClaims.map((rect) => (
                      <Polygon key={rect.id} positions={rectPolygon(rect)} pathOptions={{ color: "#22d3ee", weight: 1, fillOpacity: 0.12 }}>
                        <Popup>{rect.name}<br />Type: {rect.type}</Popup>
                      </Polygon>
                    ))}
                  </LayerGroup>
                </LayersControl.Overlay>
              </>
            )}
            <LayersControl.Overlay name="Region grid">
              <LayerGroup>{regions}</LayerGroup>
            </LayersControl.Overlay>
          </LayersControl>
          <MapViewportControls bounds={mapBounds} />
          <MapLegend prismaConfigured={prismaConfigured} />
          <Coordinates />
        </MapContainer>
      </div>
    </div>
  );
}
