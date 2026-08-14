"use client";
import { useEffect, useState } from "react";
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
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { api, ServerInstance } from "../../../lib/api";
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
type Region = { name: string; x: number; z: number };
type WorldInfo = {
  width: number;
  height: number;
  gameVersion?: string;
  seed?: string;
  source: string;
};
type CommandJobRun = {
  status: string;
  result?: { errorMessage?: string } | null;
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
  MAX_HISTORY = 25_920;
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
function PlayerTracker({ player }: { player?: Entity }) {
  const map = useMap();
  useEffect(() => {
    if (player)
      map.flyTo(
        [player.position.x, player.position.z],
        Math.max(map.getZoom(), 3),
        { duration: 0.6 },
      );
  }, [map, player?.position.x, player?.position.z]);
  return null;
}
export default function LiveMapClient() {
  const orgId = getStoredOrgId();
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [feedError, setFeedError] = useState(""),
    [config, setConfig] = useState<Config | null>(null),
    [players, setPlayers] = useState<Entity[]>([]),
    [animals, setAnimals] = useState<Entity[]>([]),
    [hostiles, setHostiles] = useState<Entity[]>([]),
    [claims, setClaims] = useState<Claim[]>([]),
    [regionFiles, setRegionFiles] = useState<Region[]>([]),
    [worldInfo, setWorldInfo] = useState<WorldInfo | null>(null),
    [gameTime, setGameTime] = useState(""),
    [history, setHistory] = useState<Snapshot[]>([]),
    [historyIndex, setHistoryIndex] = useState<number | null>(null),
    [historyWindow, setHistoryWindow] = useState(120),
    [trackedPlayer, setTrackedPlayer] = useState(""),
    [trackingColor, setTrackingColor] = useState("#ff2bd6"),
    [showClaims, setShowClaims] = useState(true),
    [showPlayerNames, setShowPlayerNames] = useState(true),
    [server, setServer] = useState<ServerInstance | null>(null),
    [visitBusy, setVisitBusy] = useState(false),
    [visitNotice, setVisitNotice] = useState(""),
    [visitStatus, setVisitStatus] = useState<VisitMapStatus>({ state: "idle" }),
    [visitSection, setVisitSection] = useState(0);
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
          setFeedError("");
        })
        .catch((e) => active && setFeedError(e.message));
      void get("claims-live")
        .then((c) => active && setClaims(c.claims ?? []))
        .catch((e) => active && setFeedError(`Claims: ${e.message}`));
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

  async function sendVisitCommand(command: string, successMessage: string) {
    if (!orgId || !server || visitBusy) return;
    setVisitBusy(true);
    setVisitNotice("");
    try {
      const queued = await api.post<{ jobRunId: string }>(
        `/api/orgs/${orgId}/jobs`,
        { serverInstanceId: server.id, type: "RCON", payload: { command } },
      );
      let run: CommandJobRun | null = null;
      for (let attempt = 0; attempt < 120; attempt++) {
        run = await api.get<CommandJobRun | null>(
          `/api/orgs/${orgId}/jobs/runs/${queued.jobRunId}`,
        );
        if (run?.status === "success" || run?.status === "failed") break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (run?.status !== "success") {
        throw new Error(
          run?.result?.errorMessage || "The visitmap command did not start within 30 seconds.",
        );
      }
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
  const divisor = 2 ** (config.maxZoom ?? 4);
  const crs = L.extend({}, L.CRS.Simple, {
    projection: {
      project: (p: L.LatLng) => new L.Point(p.lat / divisor, p.lng / divisor),
      unproject: (p: L.Point) => new L.LatLng(p.x * divisor, p.y * divisor),
      bounds: L.bounds([-Infinity, -Infinity], [Infinity, Infinity]),
    },
    transformation: new L.Transformation(1, 0, -1, 0),
    scale: (zoom: number) => 2 ** zoom,
  }) as L.CRS;
  const windowedHistory = history.filter(
    (snapshot) => snapshot.at >= Date.now() - historyWindow * 60_000,
  );
  const viewed =
    historyIndex === null
      ? { at: Date.now(), players, animals, hostiles }
      : windowedHistory[historyIndex] || { at: Date.now(), players, animals, hostiles };
  const playerChoices = [
    ...new Map(
      history
        .flatMap((s) => s.players)
        .concat(players)
        .map((p) => [String(p.id), p]),
    ).values(),
  ];
  const visibleIds = trackedPlayer
    ? [trackedPlayer]
    : [...new Set(viewed.players.map((p) => String(p.id)))];
  const trails = visibleIds
    .map((id) =>
      windowedHistory
        .slice(0, historyIndex === null ? undefined : historyIndex + 1)
        .flatMap((s) =>
          s.players
            .filter((p) => String(p.id) === id)
            .map((p) => [p.position.x, p.position.z] as [number, number]),
        )
        .slice(-60),
    )
    .filter((line) => line.length > 1);
  const tracked = viewed.players.find((p) => String(p.id) === trackedPlayer);
  return (
    <div>
      <div
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
          <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 12 }}>
            <span style={{ color: "#60a5fa" }}>
              Players {viewed.players.length}
            </span>
            <span style={{ color: "#4ade80" }}>
              Animals {viewed.animals.length}
            </span>
            <span style={{ color: "#f87171" }}>
              Hostiles {viewed.hostiles.length}
            </span>
            <span style={{ color: "#c084fc" }}>Claims {claims.length}</span>
            {feedError && (
              <span style={{ color: "#fbbf24" }}>Feed error: {feedError}</span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <strong style={{ color: "#fbbf24" }}>{gameTime}</strong>
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
            <option key={p.id} value={String(p.id)}>
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
        <select
          aria-label="Player history timeframe"
          value={historyWindow}
          onChange={(event) => {
            setHistoryWindow(Number(event.target.value));
            setHistoryIndex(null);
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
            color: historyIndex === null ? "#4ade80" : "#fbbf24",
            minWidth: 110,
          }}
        >
          {historyIndex === null
            ? "● LIVE"
            : new Date(viewed.at).toLocaleTimeString()}
        </span>
        <input
          aria-label="Map history time"
          type="range"
          min={0}
          max={windowedHistory.length}
          value={historyIndex === null ? windowedHistory.length : historyIndex}
          onChange={(e) => {
            const n = Number(e.target.value);
            setHistoryIndex(n === windowedHistory.length ? null : n);
          }}
          disabled={!windowedHistory.length}
          style={{ flex: 1, minWidth: 150, accentColor: "#f59e0b" }}
        />
        <button
          onClick={() => setHistoryIndex(null)}
          disabled={historyIndex === null}
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
          {windowedHistory.length} points
        </span>
      </div>
      <div
        style={{
          height: "calc(100vh - 230px)",
          minHeight: 520,
          border: "1px solid #252532",
          borderRadius: 9,
          overflow: "hidden",
        }}
      >
        <MapContainer
          center={[0, 0]}
          zoom={1}
          minZoom={-1}
          maxZoom={5}
          crs={crs}
          style={{ height: "100%", width: "100%", background: "#111827" }}
        >
          <PlayerTracker player={tracked} />
          <TileLayer
            url="/api/live-map/map/{z}/{x}/{y}.png"
            tileSize={128}
            minZoom={-1}
            minNativeZoom={0}
            maxNativeZoom={config.maxZoom ?? 4}
          />
          <LayersControl position="topright">
            <LayersControl.Overlay name="Players" checked>
              <LayerGroup>
                {trails.map((line, i) => (
                  <LayerGroup key={`trail-${i}`}>
                    {trackedPlayer && <Polyline positions={line} pathOptions={{ color: "#020617", weight: 8, opacity: 0.8 }} />}
                    <Polyline
                      positions={line}
                      pathOptions={{
                        color: trackedPlayer ? trackingColor : "#60a5fa",
                        weight: trackedPlayer ? 5 : 2,
                        opacity: trackedPlayer ? 1 : 0.55,
                      }}
                    />
                  </LayerGroup>
                ))}
                {viewed.players.map((e) => (
                  <Marker
                    key={e.id}
                    position={[e.position.x, e.position.z]}
                    opacity={
                      !trackedPlayer || String(e.id) === trackedPlayer
                        ? 1
                        : 0.35
                    }
                    icon={dot(
                      String(e.id) === trackedPlayer ? trackingColor : "#3b82f6",
                    )}
                  >
                    <Popup>
                      {e.name}
                      <br />
                      {Math.round(e.position.x)}, {Math.round(e.position.z)}
                      {String(e.id) === trackedPlayer && (
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
            <LayersControl.Overlay name="Region grid">
              <LayerGroup>{regions}</LayerGroup>
            </LayersControl.Overlay>
          </LayersControl>
          <Coordinates />
        </MapContainer>
      </div>
    </div>
  );
}
