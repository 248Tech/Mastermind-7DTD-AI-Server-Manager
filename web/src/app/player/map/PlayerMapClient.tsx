'use client';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { MapContainer, TileLayer, Marker, Popup, LayersControl, LayerGroup, Rectangle, useMap } from 'react-leaflet';
import L from 'leaflet';
import { PortalFrame } from '../PortalFrame';

type Entity = { id: string | number; name: string; position: { x: number; y: number; z: number } };
type Config = { enabled: boolean; maxZoom?: number; mapSize: { x: number; y: number; z: number } };
type Profile = { name: string; steamId: string; serverName: string; online: boolean; auth?: string };
type Places = {
  claims: Array<{ id: string; position: { x: number; y: number; z: number }; size: number }>;
  homes: Array<{ id: string; position: { x: number; y: number; z: number }; active: boolean }>;
  vehicles: Array<{ id: string; name: string; position: { x: number; y: number; z: number } }>;
  drones: Array<{ id: string; name: string; position: { x: number; y: number; z: number } }>;
};

const icon = (color: string, label?: string) => L.divIcon({
  className: '',
  html: `<div style="display:flex;align-items:center;gap:5px;white-space:nowrap"><span style="display:block;width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 5px #000"></span>${label ? `<strong style="color:white;text-shadow:0 1px 4px #000;font:12px system-ui">${label.replace(/[&<>"']/g, '')}</strong>` : ''}</div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function Fit({ bounds }: { bounds: L.LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => { map.fitBounds(bounds, { padding: [12, 12] }); }, [map, bounds]);
  return null;
}

export default function PlayerMapClient() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [players, setPlayers] = useState<Entity[]>([]);
  const [animals, setAnimals] = useState<Entity[]>([]);
  const [hostiles, setHostiles] = useState<Entity[]>([]);
  const [places, setPlaces] = useState<Places>({ claims: [], homes: [], vehicles: [], drones: [] });
  const [error, setError] = useState('');
  const [feedError, setFeedError] = useState('');

  useEffect(() => {
    fetch('/api/player-auth/me', { cache: 'no-store' }).then(async (r) => {
      if (r.ok) {
        const next = await r.json();
        if (next.auth !== 'name') setProfile(next);
      }
    });
  }, []);

  useEffect(() => {
    let active = true;
    const get = async (path: string) => {
      const r = await fetch(`/api/player-map/${path}`, { cache: 'no-store' });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message || `Map error ${r.status}`);
      return body.data ?? body;
    };
    get('api/map/config').then((v) => active && setConfig(v)).catch((e) => active && setError(e.message));
    const update = () => get('entities-live').then((v) => {
      if (!active) return;
      setPlayers(v.players ?? []);
      setAnimals(v.animals ?? []);
      setHostiles(v.hostiles ?? []);
      const errors = v.errors || {};
      setFeedError([errors.players, errors.hostiles, errors.animals].filter(Boolean).join(' · ') || '');
    }).catch((e) => active && setFeedError(e.message));
    update();
    const timer = setInterval(update, 10000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!profile) return;
    let active = true;
    const update = () => fetch('/api/player-auth/places', { cache: 'no-store' }).then(async (r) => {
      if (!r.ok || !active) return;
      const next = await r.json() as Places;
      setPlaces({
        claims: next.claims ?? [],
        homes: next.homes ?? [],
        vehicles: next.vehicles ?? [],
        drones: next.drones ?? [],
      });
    }).catch(() => undefined);
    update();
    const timer = setInterval(update, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [profile]);

  const mapSize = config?.mapSize || { x: 10240, y: 255, z: 10240 };
  const bounds = useMemo(() => L.latLngBounds([-mapSize.x / 2, -mapSize.z / 2], [mapSize.x / 2, mapSize.z / 2]), [mapSize.x, mapSize.z]);
  const crs = useMemo(() => {
    const divisor = 2 ** (config?.maxZoom ?? 4);
    return L.extend({}, L.CRS.Simple, {
      projection: {
        project: (p: L.LatLng) => new L.Point(p.lat / divisor, p.lng / divisor),
        unproject: (p: L.Point) => new L.LatLng(p.x * divisor, p.y * divisor),
        bounds: L.bounds([-Infinity, -Infinity], [Infinity, Infinity]),
      },
      transformation: new L.Transformation(1, 0, -1, 0),
      scale: (zoom: number) => 2 ** zoom,
    }) as L.CRS;
  }, [config?.maxZoom]);

  if (error) return <PortalFrame profile={profile} wide><div style={alertStyle}>{error}</div></PortalFrame>;
  if (!config) return <PortalFrame profile={profile} wide><p style={{ color: '#94a3b8' }}>Connecting to live map…</p></PortalFrame>;

  return (
    <PortalFrame profile={profile} wide>
      <div style={{ display: 'flex', gap: 13, flexWrap: 'wrap', fontSize: 13, marginBottom: 8 }}>
        {profile ? <span style={{ color: '#60a5fa' }}>Players {players.length} · Steam verified</span> : <a href="/player" style={{ color: '#fbbf24' }}>Players hidden · sign in through Steam</a>}
        <span style={{ color: '#4ade80' }}>Animals {animals.length}</span>
        <span style={{ color: '#f87171' }}>Zombies/hostiles {hostiles.length}</span>
        {profile && <span style={{ color: '#c084fc' }}>Your claims {places.claims.length}</span>}
        {feedError && <span style={{ color: '#fbbf24' }}>{feedError}</span>}
      </div>
      <div style={{ height: 'calc(100vh - 165px)', minHeight: 480, border: '1px solid #292936', borderRadius: 10, overflow: 'hidden' }}>
        <MapContainer crs={crs} center={[0, 0]} zoom={1} minZoom={-1} maxZoom={5} maxBounds={bounds.pad(0.12)} fadeAnimation={false} style={{ height: '100%', width: '100%', background: '#111827' }}>
          <Fit bounds={bounds} />
          <TileLayer url="/api/player-map/map/{z}/{x}/{y}.png" noWrap bounds={bounds} tileSize={128} minZoom={-1} minNativeZoom={0} maxNativeZoom={config.maxZoom ?? 4} keepBuffer={16} updateInterval={50} updateWhenIdle={false} updateWhenZooming />
          <LayersControl position="topright">
            {profile && (
              <LayersControl.Overlay checked name="Players">
                <LayerGroup>{players.map((e) => <Marker key={e.id} position={[e.position.x, e.position.z]} icon={icon('#3b82f6', e.name)}><Popup><strong>{e.name}</strong><br />{Math.round(e.position.x)}, {Math.round(e.position.z)}</Popup></Marker>)}</LayerGroup>
              </LayersControl.Overlay>
            )}
            {profile && (
              <LayersControl.Overlay checked name={`Your claims (${places.claims.length})`}>
                <LayerGroup>
                  {places.claims.map((claim) => {
                    const half = claim.size / 2;
                    return (
                      <Rectangle
                        key={claim.id}
                        bounds={[[claim.position.x - half, claim.position.z - half], [claim.position.x + half, claim.position.z + half]]}
                        pathOptions={{ color: '#a855f7', weight: 2, fill: true, fillColor: '#7e22ce', fillOpacity: 0.16 }}
                      >
                        <Popup>Your land claim<br />{Math.round(claim.position.x)}, {Math.round(claim.position.z)} · {claim.size}×{claim.size}</Popup>
                      </Rectangle>
                    );
                  })}
                </LayerGroup>
              </LayersControl.Overlay>
            )}
            {profile && (
              <LayersControl.Overlay checked name={`Your bed (${places.homes.length})`}>
                <LayerGroup>{places.homes.map((home) => <Marker key={home.id} position={[home.position.x, home.position.z]} icon={icon('#fbbf24', 'Bed')}><Popup>Your bed{home.active ? '' : ' (inactive)'}<br />{Math.round(home.position.x)}, {Math.round(home.position.z)}</Popup></Marker>)}</LayerGroup>
              </LayersControl.Overlay>
            )}
            {profile && (
              <LayersControl.Overlay checked name={`Your vehicles (${places.vehicles.length})`}>
                <LayerGroup>{places.vehicles.map((vehicle) => <Marker key={vehicle.id} position={[vehicle.position.x, vehicle.position.z]} icon={icon('#38bdf8', vehicle.name)}><Popup>{vehicle.name}<br />{Math.round(vehicle.position.x)}, {Math.round(vehicle.position.z)}</Popup></Marker>)}</LayerGroup>
              </LayersControl.Overlay>
            )}
            {profile && (
              <LayersControl.Overlay checked name={`Your drones (${places.drones.length})`}>
                <LayerGroup>{places.drones.map((drone) => <Marker key={drone.id} position={[drone.position.x, drone.position.z]} icon={icon('#f472b6', drone.name)}><Popup>{drone.name}<br />{Math.round(drone.position.x)}, {Math.round(drone.position.z)}</Popup></Marker>)}</LayerGroup>
              </LayersControl.Overlay>
            )}
            <LayersControl.Overlay checked name="Animals">
              <LayerGroup>{animals.map((e) => <Marker key={e.id} position={[e.position.x, e.position.z]} icon={icon('#22c55e')}><Popup>{e.name}</Popup></Marker>)}</LayerGroup>
            </LayersControl.Overlay>
            <LayersControl.Overlay checked name="Zombies & hostiles">
              <LayerGroup>{hostiles.map((e) => <Marker key={e.id} position={[e.position.x, e.position.z]} icon={icon('#ef4444')}><Popup>{e.name}</Popup></Marker>)}</LayerGroup>
            </LayersControl.Overlay>
          </LayersControl>
        </MapContainer>
      </div>
    </PortalFrame>
  );
}

const alertStyle: CSSProperties = { padding: '1rem', background: '#3f1d25', color: '#fca5a5', borderRadius: 8 };
