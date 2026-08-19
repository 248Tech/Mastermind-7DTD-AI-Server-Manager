'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { PortalFrame } from '../../PortalFrame';
import { ShopDescription, ShopImage } from '../../../../lib/shop-copy';
import { ShopAuthGate } from '../../../../lib/shop-auth';
import {
  money,
  shopAlert,
  shopBackLink,
  shopEyebrow,
  shopPrimary,
  shopSuccess,
  startShopCheckout,
  shopItemImageUrl,
  type ShopItem,
  type ShopProfile,
} from '../../../../lib/shop-player';
import { useShopCart } from '../../../../lib/shop-cart';

export default function PlayerShopItemPage() {
  return (
    <Suspense fallback={<PortalFrame profile={null}><p style={{ color: '#94a3b8' }}>Loading item…</p></PortalFrame>}>
      <PlayerShopItemContent />
    </Suspense>
  );
}

function PlayerShopItemContent() {
  const params = useParams();
  const query = useSearchParams();
  const itemId = typeof params.id === 'string' ? params.id : '';
  const donationResult = query.get('donation');
  const [profile, setProfile] = useState<ShopProfile | null>(null);
  const [item, setItem] = useState<ShopItem | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [donateError, setDonateError] = useState('');
  const { add, remove, has } = useShopCart();
  const inCart = item ? has(item.id) : false;

  useEffect(() => {
    if (!itemId) {
      setError('Item not found');
      setChecking(false);
      return;
    }
    Promise.all([
      fetch('/api/player-auth/me', { cache: 'no-store' }).then(async (r) => {
        if (!r.ok) return null;
        return r.json() as Promise<ShopProfile>;
      }),
      fetch(`/api/player-auth/shop/items/${encodeURIComponent(itemId)}`, { cache: 'no-store' }).then(async (r) => {
        if (r.status === 404) throw new Error('That shop item is not available');
        if (!r.ok) throw new Error('Could not load this shop item');
        return r.json() as Promise<ShopItem>;
      }),
    ])
      .then(([nextProfile, nextItem]) => {
        if (nextProfile) setProfile(nextProfile);
        setItem(nextItem);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load this shop item'))
      .finally(() => setChecking(false));
  }, [itemId]);

  async function checkout() {
    if (!item) return;
    setDonateError('');
    setBusy(true);
    try {
      await startShopCheckout({ shopItemId: item.id });
    } catch (e) {
      setDonateError(e instanceof Error ? e.message : 'Could not start checkout');
      setBusy(false);
    }
  }

  if (checking) return <PortalFrame profile={null}><p style={{ color: '#94a3b8' }}>Loading item…</p></PortalFrame>;
  if (error || !item) {
    return (
      <PortalFrame profile={profile}>
        <a href="/player/shop" style={shopBackLink}>← Back to donator shop</a>
        <div style={shopAlert}>{error || 'That shop item is not available.'}</div>
      </PortalFrame>
    );
  }

  const signedIn = Boolean(profile?.name);
  const checkoutReady = signedIn && Boolean(profile?.donation?.checkoutEnabled);
  const donateDisabled = !checkoutReady || busy;
  const steamLast4 = profile?.steamId ? profile.steamId.slice(-4) : '';

  return (
    <PortalFrame profile={profile} maxWidth={760}>
      <a href="/player/shop" style={shopBackLink}>← Back to donator shop</a>
      {donationResult === 'success' && <div style={shopSuccess}>Thank you. Your supporter status updates after Stripe confirms the payment.</div>}
      {donationResult === 'cancel' && <div style={shopAlert}>Checkout was cancelled. No charge was made.</div>}
      {donateError && <div style={shopAlert}>{donateError}</div>}
      {signedIn && !profile?.donation?.checkoutEnabled && <div style={shopAlert}>Donations are not configured yet.</div>}

      <article className="shop-detail">
        {item.hasImage ? (
          <ShopImage src={shopItemImageUrl(item.id, 'full')} alt={item.name} />
        ) : (
          <div style={{ height: 120, display: 'grid', placeItems: 'center', color: '#64748b', background: '#050508' }}>No picture</div>
        )}
        <div className="shop-item-body">
          <p style={shopEyebrow}>DONATOR ITEM</p>
          <h1 className="shop-item-title">{item.name}</h1>
          {item.description && <ShopDescription text={item.description} />}
          <div className="shop-item-actions">
            <span className="shop-price">{money(item.priceCents)}</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {inCart ? (
                <>
                  <button type="button" onClick={() => remove(item.id)} style={secondary}>Remove from cart</button>
                  <a href="/player/shop/cart" style={{ ...shopPrimary, textDecoration: 'none' }}>Visit cart</a>
                </>
              ) : (
                <button type="button" onClick={() => add(item.id)} style={secondary}>Add to cart</button>
              )}
              {signedIn && (
                <button
                  disabled={donateDisabled}
                  onClick={() => void checkout()}
                  style={{ ...shopPrimary, opacity: donateDisabled ? 0.7 : 1, cursor: donateDisabled ? 'not-allowed' : 'pointer' }}
                >
                  {busy ? 'Opening…' : `Donate ${money(item.priceCents)}`}
                </button>
              )}
            </div>
          </div>
          {signedIn ? (
            <p style={{ color: '#64748b', fontSize: 12, margin: '14px 0 0', lineHeight: 1.5 }}>
              {profile?.auth === 'name'
                ? `Gift tied to in-game name ${profile.name} on ${profile.serverName}.`
                : `Gift tied to Steam ending ${steamLast4} on ${profile?.serverName}.`}
            </p>
          ) : (
            <div style={{ marginTop: 16 }}>
              <ShopAuthGate next={`/player/shop/${item.id}`} />
            </div>
          )}
        </div>
      </article>
    </PortalFrame>
  );
}

const secondary: React.CSSProperties = { color: '#cbd5e1', background: '#27272f', border: '1px solid #3f3f49', padding: '.55rem .85rem', borderRadius: 8, fontWeight: 600, cursor: 'pointer' };
