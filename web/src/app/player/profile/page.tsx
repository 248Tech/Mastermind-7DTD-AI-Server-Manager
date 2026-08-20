'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PortalFrame } from '../PortalFrame';
import { InventoryGrid } from '../../../components/InventoryGrid';

type InventoryItem = { slot: string; count: number; name: string };
type Inventory = { bag?: InventoryItem[]; belt?: InventoryItem[]; equipment?: InventoryItem[]; other?: InventoryItem[]; empty?: boolean };
type Donation = {
  status: string;
  tiedTo: string;
  steamLast4: string;
  checkoutEnabled?: boolean;
  supporter?: boolean;
  supporterSince?: string | null;
  totalDonatedCents?: number;
  recent?: Array<{ amountCents: number; at: string }>;
};
type Profile = {
  name: string;
  steamId: string;
  serverName: string;
  online: boolean;
  auth?: 'steam' | 'name';
  isAdmin?: boolean;
  stats?: {
    level: number;
    zombieKills: number;
    playerKills: number;
    deaths: number;
    sessionSeconds: number;
    lifetimeSeconds: number;
    firstSeenAt: string;
    lastSeenAt: string;
  };
  location: { x: number; y: number | null; z: number; lastLogoutAt: string | null; source: string } | null;
  inventory: Inventory | null;
  inventoryAt: string | null;
  donation: Donation;
};

type Places = {
  auth: 'steam' | 'name';
  reachable: boolean;
  claims: Array<{ id: string; position: { x: number; y: number; z: number }; size: number }>;
  homes: Array<{ id: string; position: { x: number; y: number; z: number }; active: boolean }>;
  vehicles: Array<{ id: string; name: string; position: { x: number; y: number; z: number } }>;
  drones: Array<{ id: string; name: string; position: { x: number; y: number; z: number } }>;
};

const PRESETS = [500, 1000, 2500, 5000];

function duration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function when(value?: string | null) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleString();
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function isStripeCheckoutUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'checkout.stripe.com' || parsed.hostname.endsWith('.stripe.com'));
  } catch {
    return false;
  }
}

export default function PlayerProfilePage() {
  return (
    <Suspense fallback={<PortalFrame profile={null}><p style={{ color: '#94a3b8' }}>Loading your profile…</p></PortalFrame>}>
      <PlayerProfileContent />
    </Suspense>
  );
}

function PlayerProfileContent() {
  const query = useSearchParams();
  const donationResult = query.get('donation');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);
  const [amountCents, setAmountCents] = useState(1000);
  const [custom, setCustom] = useState('');
  const [donating, setDonating] = useState(false);
  const [donateError, setDonateError] = useState('');
  const [places, setPlaces] = useState<Places | null>(null);

  useEffect(() => {
    fetch('/api/player-auth/me', { cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 401) {
          setError('Sign in through Steam to view your individual profile.');
          return;
        }
        if (!r.ok) throw new Error('Could not load your profile');
        const next = await r.json() as Profile;
        setProfile(next);
        if (next.auth === 'steam') {
          const placesResponse = await fetch('/api/player-auth/places', { cache: 'no-store' });
          if (placesResponse.ok) setPlaces(await placesResponse.json());
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load your profile'))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <PortalFrame profile={null}><p style={{ color: '#94a3b8' }}>Loading your profile…</p></PortalFrame>;
  if (error || !profile) return <PortalFrame profile={null}><div style={alert}>{error || 'Sign in through Steam to view your profile.'}</div><a href="/api/player-auth/steam/start?next=/player/profile" style={{ color: '#fb923c' }}>Sign in through Steam</a></PortalFrame>;
  if (profile.auth === 'name' || !profile.stats) {
    return (
      <PortalFrame profile={profile}>
        <div style={alert}>Sign in through Steam to view stats, inventory, logout location, and your land. Shop accounts are for purchases only.</div>
        <a href="/api/player-auth/steam/start?next=/player/profile" style={{ color: '#fb923c' }}>Sign in through Steam</a>
      </PortalFrame>
    );
  }

  const stats = profile.stats;
  const inventory = profile.inventory;
  const donation = profile.donation;
  const sections: Array<[string, InventoryItem[] | undefined]> = [
    ['Bag', inventory?.bag],
    ['Belt', inventory?.belt],
    ['Equipment', inventory?.equipment],
    ['Other', inventory?.other],
  ];
  const selectedCents = custom.trim() ? Math.round(Number(custom) * 100) : amountCents;
  const checkoutReady = Boolean(donation?.checkoutEnabled);

  async function donate() {
    setDonateError('');
    if (!Number.isInteger(selectedCents) || selectedCents < 500 || selectedCents > 50000) {
      setDonateError('Choose an amount between $5 and $500.');
      return;
    }
    setDonating(true);
    try {
      const response = await fetch('/api/player-auth/donations/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amountCents: selectedCents }),
      });
      const data = await response.json().catch(() => ({})) as { url?: string; message?: string };
      if (!response.ok) throw new Error(data.message || 'Could not start checkout');
      if (typeof data.url !== 'string' || !isStripeCheckoutUrl(data.url)) {
        throw new Error('Checkout is unavailable');
      }
      location.href = data.url;
    } catch (e) {
      setDonateError(e instanceof Error ? e.message : 'Could not start checkout');
      setDonating(false);
    }
  }

  return (
    <PortalFrame profile={profile}>
      <div style={{ display: 'grid', gap: 16 }}>
        {profile.isAdmin && <div style={{ ...card, borderColor: '#4f46e5', background: 'linear-gradient(90deg, rgba(79,70,229,.18), rgba(17,17,24,.95))', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><span style={{ color: '#c4b5fd', fontSize: 13 }}>Administrator access detected for this player.</span><a href="/" style={{ color: '#c4b5fd', fontWeight: 700 }}>Open admin dashboard →</a></div>}
        <section style={card}>
          <p style={eyebrow}>YOUR PROFILE</p>
          <h1 style={{ margin: '0 0 6px', fontSize: '1.7rem' }}>{profile.name}</h1>
          <p style={{ color: '#94a3b8', margin: 0 }}>
            {profile.serverName} · Steam ending {profile.steamId.slice(-4)} · {profile.online ? 'Online now' : 'Offline'}
            {donation?.supporter ? ' · Supporter' : ''}
          </p>
        </section>

        <section style={card}>
          <h2 style={heading}>Stats</h2>
          <div style={statGrid}>
            <Stat label="Level" value={String(stats?.level ?? 1)} />
            <Stat label="Zombie kills" value={String(stats?.zombieKills ?? 0)} />
            <Stat label="Player kills" value={String(stats?.playerKills ?? 0)} />
            <Stat label="Deaths" value={String(stats?.deaths ?? 0)} />
            <Stat label="This session" value={profile.online ? duration(stats?.sessionSeconds ?? 0) : '—'} />
            <Stat label="Lifetime" value={duration(stats?.lifetimeSeconds ?? 0)} />
            <Stat label="First seen" value={when(stats?.firstSeenAt)} />
            <Stat label="Last seen" value={when(stats?.lastSeenAt)} />
          </div>
        </section>

        <section style={card}>
          <h2 style={heading}>Last logout location</h2>
          {profile.location ? (
            <div>
              <p style={{ margin: '0 0 8px', fontSize: '1.15rem' }}>
                {Math.round(profile.location.x)}, {Math.round(profile.location.y ?? 0)}, {Math.round(profile.location.z)}
              </p>
              <p style={{ color: '#94a3b8', margin: 0, fontSize: 13 }}>
                {profile.location.source === 'last_logout' ? 'Last reported logout' : 'Last reported position while online'}
                {profile.location.lastLogoutAt ? ` · Logged out ${when(profile.location.lastLogoutAt)}` : ''}
              </p>
            </div>
          ) : (
            <p style={{ color: '#94a3b8', margin: 0 }}>No logout coordinates yet. They appear after the next live player poll while you are in-game.</p>
          )}
        </section>

        <section style={card}>
          <h2 style={heading}>Your places</h2>
          {!places || (!places.claims.length && !places.homes.length && !places.vehicles.length && !places.drones.length) ? (
            <p style={{ color: '#94a3b8', margin: 0 }}>
              {places && !places.reachable
                ? 'Land data is unavailable right now.'
                : 'No land claims, bed, vehicles, or drones linked to this Steam account yet.'}
              {' '}<a href="/player/map" style={{ color: '#60a5fa' }}>Open the map</a>
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {places.claims.map((claim) => (
                <p key={claim.id} style={placeLine}>Land claim · {Math.round(claim.position.x)}, {Math.round(claim.position.z)} · {claim.size}×{claim.size}</p>
              ))}
              {places.homes.map((home) => (
                <p key={home.id} style={placeLine}>Bed{home.active ? '' : ' (inactive)'} · {Math.round(home.position.x)}, {Math.round(home.position.z)}</p>
              ))}
              {places.vehicles.map((vehicle) => (
                <p key={vehicle.id} style={placeLine}>{vehicle.name} · {Math.round(vehicle.position.x)}, {Math.round(vehicle.position.z)}</p>
              ))}
              {places.drones.map((drone) => (
                <p key={drone.id} style={placeLine}>{drone.name} · {Math.round(drone.position.x)}, {Math.round(drone.position.z)}</p>
              ))}
            </div>
          )}
        </section>

        <section style={card}>
          <h2 style={heading}>Last known inventory</h2>
          <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>
            {profile.inventoryAt ? `Snapshot ${when(profile.inventoryAt)}` : 'No valid inventory snapshot yet. The server only records this when an inventory-capable command or mod returns item data while you are online.'}
          </p>
          {!inventory || inventory.empty ? (
            <p style={{ color: '#94a3b8', margin: 0 }}>Inventory is empty or has not been captured yet.</p>
          ) : (
            <InventoryGrid sections={sections} />
          )}
        </section>

        <section style={{ ...card, borderColor: '#3f2a14', background: 'linear-gradient(180deg, rgba(249,115,22,.08), #111118)' }}>
          <h2 style={heading}>Support the server</h2>
          {donationResult === 'success' && (
            <p style={notice}>Thanks. If the payment completed, your supporter badge will appear after Stripe confirms it — refresh in a few seconds.</p>
          )}
          {donationResult === 'cancel' && (
            <p style={noticeMuted}>Checkout was cancelled. Nothing was charged.</p>
          )}
          <p style={{ color: '#cbd5e1', lineHeight: 1.55, marginTop: 0 }}>
            Support is voluntary and tied directly to this Steam account (ending {donation?.steamLast4}).
            Browse the <a href="/player/shop" style={{ color: '#fb923c' }}>donator shop</a> for featured items, or give a custom amount here.
            A supporter badge on this profile is recognition, not a purchase of in-game items.
          </p>
          {donation?.supporter && (
            <p style={{ color: '#fdba74', marginTop: 0 }}>
              Supporter{donation.supporterSince ? ` since ${when(donation.supporterSince)}` : ''}
              {typeof donation.totalDonatedCents === 'number' ? ` · ${money(donation.totalDonatedCents)} total` : ''}
            </p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => { setAmountCents(preset); setCustom(''); }}
                style={amountCents === preset && !custom.trim() ? presetOn : presetOff}
              >
                {money(preset)}
              </button>
            ))}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#94a3b8', fontSize: 13 }}>
              Custom $
              <input
                type="number"
                min={5}
                max={500}
                step={1}
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                placeholder="25"
                style={customInput}
              />
            </label>
          </div>
          {donateError && <p style={{ color: '#fca5a5', marginTop: 0 }}>{donateError}</p>}
          <button
            type="button"
            disabled={donating || !checkoutReady}
            onClick={() => void donate()}
            style={{ ...donateButton, opacity: donating || !checkoutReady ? 0.7 : 1, cursor: donating || !checkoutReady ? 'not-allowed' : 'pointer' }}
          >
            {donating ? 'Starting checkout…' : checkoutReady ? `Donate ${Number.isInteger(selectedCents) ? money(selectedCents) : ''}` : 'Donations are not configured yet'}
          </button>
          {donation?.recent && donation.recent.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <strong style={{ color: '#cbd5e1', fontSize: 13 }}>Recent support</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#e2e8f0', fontSize: 13 }}>
                {donation.recent.map((row, index) => (
                  <li key={`${row.at}-${index}`}>{money(row.amountCents)} · {when(row.at)}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </PortalFrame>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#0b0b12', border: '1px solid #1e1e2a', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ color: '#64748b', fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ marginTop: 4, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

const card: React.CSSProperties = { background: '#111118', border: '1px solid #292936', borderRadius: 12, padding: '18px 20px' };
const heading: React.CSSProperties = { margin: '0 0 12px', fontSize: '1.05rem' };
const eyebrow: React.CSSProperties = { color: '#f97316', fontSize: '.72rem', letterSpacing: '.16em', fontWeight: 800, margin: '0 0 6px' };
const statGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 };
const alert: React.CSSProperties = { padding: '1rem', background: '#3f1d25', color: '#fca5a5', borderRadius: 8 };
const notice: React.CSSProperties = { color: '#bbf7d0', background: '#052e16', border: '1px solid #166534', borderRadius: 8, padding: '10px 12px' };
const noticeMuted: React.CSSProperties = { color: '#cbd5e1', background: '#0b0b12', border: '1px solid #292936', borderRadius: 8, padding: '10px 12px' };
const donateButton: React.CSSProperties = { color: '#fed7aa', background: '#9a3412', border: 0, borderRadius: 8, padding: '.7rem 1.1rem', fontWeight: 700 };
const presetOn: React.CSSProperties = { color: '#fff7ed', background: '#9a3412', border: '1px solid #c2410c', borderRadius: 8, padding: '.45rem .8rem', cursor: 'pointer', fontWeight: 700 };
const presetOff: React.CSSProperties = { color: '#fdba74', background: '#1c1008', border: '1px solid #7c2d12', borderRadius: 8, padding: '.45rem .8rem', cursor: 'pointer' };
const customInput: React.CSSProperties = { width: 72, background: '#0b0b12', color: '#e2e8f0', border: '1px solid #3f3f49', borderRadius: 6, padding: '6px 8px' };
const placeLine: React.CSSProperties = { margin: 0, color: '#e2e8f0', fontSize: 14 };
