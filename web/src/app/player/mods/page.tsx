'use client';

import { useEffect, useState } from 'react';
import { PortalFrame, type PortalProfile } from '../PortalFrame';

type Mod = { name: string; author: string | null; version: string | null; description: string | null; website: string | null };
type Response = { serverName: string; mods: Mod[] };

export default function PlayerModsPage() {
  const [profile, setProfile] = useState<PortalProfile | null>(null);
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetch('/api/player-auth/me', { cache: 'no-store' }), fetch('/api/player-auth/mods', { cache: 'no-store' })])
      .then(async ([me, mods]) => {
        if (me.ok) setProfile(await me.json() as PortalProfile);
        const body = await mods.json().catch(() => ({}));
        if (!mods.ok) throw new Error(body.message || 'Could not load mods');
        setData(body as Response);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load mods'))
      .finally(() => setLoading(false));
  }, []);

  return <PortalFrame profile={profile} maxWidth={920}>
    <a href="/player" style={{ color: '#fb923c', textDecoration: 'none', fontSize: 13 }}>← Player portal</a>
    <h1 style={{ margin: '14px 0 5px', fontSize: '1.7rem' }}>Server mods</h1>
    <p style={{ margin: '0 0 20px', color: '#94a3b8' }}>Published mod download pages for {data?.serverName || 'your server'}. Only supporters and administrators can view this list.</p>
    {loading && <p style={{ color: '#94a3b8' }}>Loading installed mods…</p>}
    {error && <div style={{ color: '#fecaca', background: '#3f1d25', border: '1px solid #7f1d1d', borderRadius: 8, padding: 12 }}>{error}</div>}
    {data && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 12 }}>
      {data.mods.length === 0 ? <p style={{ color: '#94a3b8' }}>No active mods found.</p> : data.mods.map((mod) => <article key={`${mod.name}:${mod.version || ''}`} style={{ background: '#111118', border: '1px solid #292936', borderRadius: 10, padding: 16 }}>
        <h2 style={{ margin: '0 0 5px', fontSize: '1rem' }}>{mod.name}</h2>
        <p style={{ margin: '0 0 11px', color: '#94a3b8', fontSize: 13 }}>{[mod.author, mod.version].filter(Boolean).join(' · ') || 'Installed mod'}</p>
        {mod.description && <p style={{ margin: '0 0 12px', color: '#cbd5e1', fontSize: 13, lineHeight: 1.45 }}>{mod.description}</p>}
        {mod.website ? <a href={mod.website} target="_blank" rel="noreferrer" style={{ display: 'inline-block', background: '#ea580c', color: 'white', textDecoration: 'none', padding: '.55rem .75rem', borderRadius: 6, fontWeight: 700, fontSize: 13 }}>Download</a> : <span style={{ color: '#64748b', fontSize: 13 }}>No public download link listed.</span>}
      </article>)}
    </div>}
  </PortalFrame>;
}
