'use client';
import { useState, useEffect } from 'react';
import { api, User, Org } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';

const card: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: '1.5rem',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  marginBottom: '1rem',
};

const inputStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderRadius: 6,
  border: '1px solid #ddd',
  fontSize: '0.9rem',
  width: '100%',
  boxSizing: 'border-box',
};

const btnPrimary: React.CSSProperties = {
  padding: '0.5rem 1rem',
  background: '#1a1a2e',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.9rem',
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: '1rem', padding: '0.6rem 0', borderBottom: '1px solid #f0f0f0', alignItems: 'baseline' }}>
      <div style={{ width: 140, fontSize: '0.85rem', color: '#888', flexShrink: 0 }}>{label}</div>
      <div style={{ fontSize: '0.9rem', fontFamily: value.startsWith('org_') || value.startsWith('usr_') ? 'monospace' : undefined }}>{value || '—'}</div>
    </div>
  );
}

export default function SettingsPage() {
  const orgId = getStoredOrgId();
  const [user, setUser] = useState<User | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Discord webhook form
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookError, setWebhookError] = useState('');
  const [webhookSuccess, setWebhookSuccess] = useState('');
  const [webhookApiNotice, setWebhookApiNotice] = useState('');

  useEffect(() => {
    if (!orgId) return;
    Promise.all([
      api.get<User>('/api/auth/me'),
      api.get<Org[]>('/api/orgs').then(orgs => orgs.find(o => o.id === orgId) || null).catch(() => null),
    ])
      .then(([u, o]) => {
        setUser(u);
        setOrg(o);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [orgId]);

  async function handleUpdateWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setWebhookLoading(true);
    setWebhookError('');
    setWebhookSuccess('');
    setWebhookApiNotice('');
    try {
      await api.patch(`/api/orgs/${orgId}`, { discordWebhookUrl: webhookUrl });
      setWebhookSuccess('Discord webhook updated successfully.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update webhook';
      if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
        setWebhookApiNotice('Org update API coming soon — this feature is not yet available on the server.');
      } else {
        setWebhookError(msg);
      }
    } finally {
      setWebhookLoading(false);
    }
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 1.5rem', fontSize: '1.6rem', color: '#1a1a2e' }}>Settings</h1>

      {error && (
        <div style={{ background: '#fde8e8', color: '#c00', padding: '0.75rem 1rem', borderRadius: 6, marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>
      )}

      {/* Org Info */}
      <div style={card}>
        <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem', color: '#1a1a2e' }}>Organisation Info</h2>
        {loading ? (
          <p style={{ color: '#888', fontSize: '0.9rem' }}>Loading…</p>
        ) : org ? (
          <div>
            <InfoRow label="Name" value={org.name} />
            <InfoRow label="Slug" value={org.slug} />
            <InfoRow label="Org ID" value={org.id} />
          </div>
        ) : (
          <p style={{ color: '#888', fontSize: '0.9rem' }}>
            Org ID: <code style={{ fontFamily: 'monospace' }}>{orgId || '—'}</code>
          </p>
        )}
      </div>

      {/* Discord Webhook */}
      <div style={card}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', color: '#1a1a2e' }}>Discord Webhook</h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: '#666' }}>
          Set a Discord webhook URL to receive notifications for alerts and important events.
        </p>
        {webhookApiNotice && (
          <div style={{ background: '#fff8e1', color: '#e65c00', padding: '0.6rem 0.75rem', borderRadius: 6, marginBottom: '0.75rem', fontSize: '0.85rem', border: '1px solid #ffe0a0' }}>
            {webhookApiNotice}
          </div>
        )}
        <form onSubmit={handleUpdateWebhook} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Webhook URL</label>
            <input
              style={inputStyle}
              type="url"
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/…"
            />
          </div>
          {webhookError && <p style={{ color: '#c00', margin: 0, fontSize: '0.85rem' }}>{webhookError}</p>}
          {webhookSuccess && <p style={{ color: '#1e7e34', margin: 0, fontSize: '0.85rem' }}>{webhookSuccess}</p>}
          <div>
            <button type="submit" style={btnPrimary} disabled={webhookLoading}>
              {webhookLoading ? 'Saving…' : 'Save Webhook'}
            </button>
          </div>
        </form>
      </div>

      {/* Agent Pairing */}
      <div style={card}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', color: '#1a1a2e' }}>Agent Pairing</h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: '#666' }}>
          To register a new host agent, generate a pairing token from the Hosts page.
        </p>
        <a href="/hosts" style={{ ...btnPrimary, textDecoration: 'none', display: 'inline-block' }}>
          Go to Hosts
        </a>
      </div>

      {/* Account */}
      <div style={card}>
        <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem', color: '#1a1a2e' }}>Account</h2>
        {loading ? (
          <p style={{ color: '#888', fontSize: '0.9rem' }}>Loading…</p>
        ) : user ? (
          <div>
            <InfoRow label="Email" value={user.email} />
            {user.name && <InfoRow label="Name" value={user.name} />}
            <InfoRow label="User ID" value={user.id} />
            <p style={{ margin: '1rem 0 0', fontSize: '0.8rem', color: '#888' }}>
              Account changes are not supported in this version. Contact your administrator to update credentials.
            </p>
          </div>
        ) : (
          <p style={{ color: '#888', fontSize: '0.9rem' }}>Could not load user info.</p>
        )}
      </div>
    </div>
  );
}
