'use client';

import { useState } from 'react';
import { shopAlert, shopInput, shopPrimary } from './shop-player';
import './shop-ui.css';

export function steamShopLoginUrl(next: string) {
  return `/api/player-auth/steam/start?next=${encodeURIComponent(next)}`;
}

export function ShopAuthGate({ next, title }: { next: string; title?: string }) {
  const [mode, setMode] = useState<'choose' | 'login' | 'register'>('choose');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(path: 'login' | 'register') {
    setError('');
    setBusy(true);
    try {
      const response = await fetch(`/api/player-auth/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, password, next }),
      });
      const data = await response.json().catch(() => ({})) as { message?: string; next?: string };
      if (!response.ok) throw new Error(data.message || 'Could not sign in');
      location.href = typeof data.next === 'string' ? data.next : next;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in');
      setBusy(false);
    }
  }

  return (
    <aside className="shop-auth-gate">
      <p style={{ color: '#f97316', fontSize: 11, letterSpacing: '.14em', fontWeight: 800, margin: '0 0 6px' }}>CONTINUE TO PURCHASE</p>
      <h2 style={{ margin: '0 0 8px', fontSize: '1.05rem' }}>{title || 'Sign in to check out'}</h2>
      <p style={{ color: '#94a3b8', margin: '0 0 14px', fontSize: 13, lineHeight: 1.5 }}>
        You can browse without an account. To buy, sign in through Steam or create a shop account that matches your in-game name.
      </p>
      {error && <div style={{ ...shopAlert, marginBottom: 12 }}>{error}</div>}
      {mode === 'choose' && (
        <div style={{ display: 'grid', gap: 8 }}>
          <a href={steamShopLoginUrl(next)} style={{ ...shopPrimary, textDecoration: 'none', textAlign: 'center' }}>Sign in through Steam</a>
          <button type="button" className="shop-card-btn" onClick={() => setMode('login')}>Sign in with in-game name</button>
          <button type="button" className="shop-card-btn shop-card-btn-muted" onClick={() => setMode('register')}>Create account with in-game name</button>
        </div>
      )}
      {mode !== 'choose' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(mode);
          }}
          style={{ display: 'grid', gap: 10 }}
        >
          <label style={{ color: '#94a3b8', fontSize: 12 }}>
            In-game name
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" required maxLength={64} style={{ ...shopInput, marginTop: 6 }} />
          </label>
          <label style={{ color: '#94a3b8', fontSize: 12 }}>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={8} maxLength={128} style={{ ...shopInput, marginTop: 6 }} />
          </label>
          <button type="submit" disabled={busy} style={{ ...shopPrimary, opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
          <button type="button" className="shop-card-btn shop-card-btn-muted" onClick={() => { setMode('choose'); setError(''); }}>Back</button>
          <p style={{ color: '#64748b', fontSize: 12, margin: 0, lineHeight: 1.45 }}>
            {mode === 'register'
              ? 'The name must already exist on this server. Play once first. This account is for shop purchases only — profile and live player markers still need Steam.'
              : 'Use the password you created for this in-game name.'}
          </p>
        </form>
      )}
    </aside>
  );
}
