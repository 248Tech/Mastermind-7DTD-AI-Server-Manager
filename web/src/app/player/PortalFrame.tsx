'use client';

import { useShopCart } from '../../lib/shop-cart';

export type PortalProfile = {
  name?: string;
  steamId?: string | null;
  serverName?: string;
  online?: boolean;
  auth?: string;
  isAdmin?: boolean;
};

function isSteamSession(profile: PortalProfile | null) {
  return Boolean(profile?.name) && profile?.auth !== 'name';
}

export function PortalFrame({
  profile,
  children,
  wide,
  maxWidth,
}: {
  profile: PortalProfile | null;
  children: React.ReactNode;
  wide?: boolean;
  maxWidth?: number;
}) {
  const signedIn = Boolean(profile?.name);
  const steam = isSteamSession(profile);
  return (
    <main style={{ minHeight: '100vh', background: '#08080d', color: '#f1f5f9' }}>
      <header style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0 18px', background: '#111118', borderBottom: '1px solid #292936' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/mastermind-logo.png" alt="" style={{ width: 38, height: 38, objectFit: 'cover', borderRadius: 8 }} />
          <div>
            <strong>Builder Friendly Player Portal</strong>
            <div style={{ color: '#64748b', fontSize: 11 }}>{profile?.serverName || 'Donator shop and Steam-verified access'}</div>
          </div>
        </div>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#94a3b8', fontSize: 13 }}>
          {profile?.name && <span style={{ color: profile.online ? '#4ade80' : '#94a3b8' }}>{profile.online ? '●' : '○'} {profile.name}</span>}
          <a href="/player" style={link}>Home</a>
          {steam && <a href="/player/profile" style={link}>Profile</a>}
          {profile?.isAdmin && <a href="/" style={link}>Admin dashboard</a>}
          <a href="/player/shop" style={link}>Shop</a>
          <CartNavLink />
          <a href="/player/map" style={link}>Map</a>
          {signedIn && (
            <button
              onClick={() => fetch('/api/player-auth/logout', { method: 'POST' }).then(() => { location.href = '/player'; })}
              style={{ ...link, background: 'transparent', border: 0, cursor: 'pointer', padding: 0, font: 'inherit' }}
            >
              Sign out
            </button>
          )}
        </nav>
      </header>
      <section style={{ padding: wide ? '14px 18px' : '18px 20px 32px', maxWidth: wide ? undefined : (maxWidth ?? 1100), margin: wide ? undefined : '0 auto' }}>{children}</section>
    </main>
  );
}

const link: React.CSSProperties = { color: '#fb923c', textDecoration: 'none' };

function CartNavLink() {
  const { count } = useShopCart();
  return (
    <a href="/player/shop/cart" style={link}>
      Cart{count > 0 ? ` (${count})` : ''}
    </a>
  );
}
