'use client';

import { useEffect, useMemo, useState } from 'react';
import { PortalFrame, type PortalProfile } from '../PortalFrame';

type Poi = { name: string; hasPreview: boolean };
type Catalog = { serverName: string; indexedAt: string | null; items: Poi[]; count: number; truncated: boolean };

export default function PlayerPoisPage() {
  const [profile, setProfile] = useState<PortalProfile | null>(null);
  const [data, setData] = useState<Catalog | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<{ name: string; url: string | null } | null>(null);
  useEffect(() => { Promise.all([fetch('/api/player-auth/me', { cache: 'no-store' }), fetch('/api/player-auth/pois', { cache: 'no-store' })]).then(async ([me, pois]) => { if (me.ok) setProfile(await me.json() as PortalProfile); const body = await pois.json().catch(() => ({})); if (!pois.ok) throw new Error(body.message || 'Could not load POIs'); setData(body as Catalog); }).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load POIs')).finally(() => setLoading(false)); }, []);
  const items = useMemo(() => { const q = search.trim().toLocaleLowerCase(); return q && data ? data.items.filter(item => item.name.toLocaleLowerCase().includes(q)) : data?.items || []; }, [data, search]);
  async function view(item: Poi) {
    if (!item.hasPreview) { setPreview({ name: item.name, url: null }); return; }
    setLoading(true); setError('');
    try { const response = await fetch(`/api/player-auth/pois/preview?name=${encodeURIComponent(item.name)}`, { cache: 'no-store' }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.message || 'Could not load POI preview'); setPreview({ name: item.name, url: body.available && body.imageBase64 ? `data:${body.mimeType || 'image/jpeg'};base64,${body.imageBase64}` : null }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load POI preview'); }
    finally { setLoading(false); }
  }
  return <PortalFrame profile={profile} maxWidth={1120}>
    <a href="/player" style={{ color: '#fb923c', textDecoration: 'none', fontSize: 13 }}>← Player portal</a>
    <h1 style={{ margin: '14px 0 5px', fontSize: '1.7rem' }}>POI Search</h1>
    <p style={{ margin: '0 0 18px', color: '#94a3b8' }}>Browse POIs installed on {data?.serverName || 'your server'}. Supporters and administrators only.</p>
    {loading && !data && <p style={{ color: '#94a3b8' }}>Loading POI catalogue…</p>}
    {error && <div style={{ color: '#fecaca', background: '#3f1d25', border: '1px solid #7f1d1d', borderRadius: 8, padding: 12 }}>{error}</div>}
    {data && <><div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search POI name…" aria-label="Search POIs" style={{ flex: 1, background: '#111118', color: '#e2e8f0', border: '1px solid #292936', borderRadius: 7, padding: '.65rem' }}/><small style={{ color: '#64748b' }}>{items.length} of {data.count}</small></div>
      {preview && <section style={{ background: '#111118', border: '1px solid #37305c', borderRadius: 10, padding: 14, marginBottom: 14 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><strong>{preview.name}</strong><button onClick={() => setPreview(null)} style={{ background: '#334155', color: 'white', border: 0, borderRadius: 6, padding: '.45rem .65rem' }}>Close</button></div>{preview.url ? <img src={preview.url} alt={`${preview.name} preview`} style={{ display: 'block', maxWidth: '100%', marginTop: 12, borderRadius: 6 }} /> : <p style={{ color: '#94a3b8' }}>No preview image is bundled for this prefab.</p>}</section>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 10 }}>{items.slice(0, 200).map(item => <article key={item.name} style={{ background: '#111118', border: '1px solid #292936', borderRadius: 8, padding: 12 }}><strong style={{ overflowWrap: 'anywhere' }}>{item.name}</strong><div style={{ marginTop: 10 }}><button disabled={loading} onClick={() => void view(item)} style={{ background: item.hasPreview ? '#ea580c' : '#334155', color: 'white', border: 0, borderRadius: 6, padding: '.45rem .65rem', cursor: 'pointer' }}>{item.hasPreview ? 'View preview' : 'No preview'}</button></div></article>)}</div>
      {items.length > 200 && <p style={{ color: '#94a3b8' }}>Showing the first 200 results. Refine your search.</p>}</>}
  </PortalFrame>;
}
