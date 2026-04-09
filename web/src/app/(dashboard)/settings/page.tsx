'use client';
import { useState, useEffect } from 'react';
import { api, User, Org } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';

// ─── Design tokens ────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: '#111118', borderRadius: 10, padding: '1.5rem',
  border: '1px solid #1e1e2a', marginBottom: '1rem',
};

const inputStyle: React.CSSProperties = {
  padding: '0.55rem 0.875rem', borderRadius: 7, border: '1px solid #252532',
  fontSize: '0.875rem', background: '#0d0d14', color: '#f1f5f9',
  width: '100%', outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s',
};

const btnPrimary: React.CSSProperties = {
  padding: '0.5rem 1.125rem', background: '#6366f1', color: '#fff', border: 'none',
  borderRadius: 7, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600,
  boxShadow: '0 2px 8px rgba(99,102,241,0.25)',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.3rem', fontWeight: 500,
};

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '1rem', padding: '0.75rem 0', borderBottom: '1px solid #1a1a24', alignItems: 'baseline' }}>
      <div style={{ width: 140, fontSize: '0.78rem', color: '#64748b', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '0.875rem', color: '#e2e8f0', fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-all' }}>{value || '—'}</div>
    </div>
  );
}

function onFocus(e: React.FocusEvent<HTMLInputElement>) {
  e.target.style.borderColor = '#6366f1';
  e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)';
}
function onBlur(e: React.FocusEvent<HTMLInputElement>) {
  e.target.style.borderColor = '#252532';
  e.target.style.boxShadow = 'none';
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const orgId = getStoredOrgId();
  const [user, setUser] = useState<User | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookError, setWebhookError] = useState('');
  const [webhookSuccess, setWebhookSuccess] = useState('');

  const [frigateUrl, setFrigateUrl] = useState('');
  const [frigateApiKey, setFrigateApiKey] = useState('');
  const [frigateWebhookSecret, setFrigateWebhookSecret] = useState('');
  const [frigateLoading, setFrigateLoading] = useState(false);
  const [frigateError, setFrigateError] = useState('');
  const [frigateSuccess, setFrigateSuccess] = useState('');
  const [frigateTestLoading, setFrigateTestLoading] = useState(false);
  const [frigateTestResult, setFrigateTestResult] = useState<{ ok: boolean; version?: string; error?: string } | null>(null);

  useEffect(() => {
    if (!orgId) return;
    Promise.all([
      api.get<User>('/api/auth/me'),
      api.get<Org[]>('/api/orgs').then(orgs => orgs.find(o => o.id === orgId) || null).catch(() => null),
    ])
      .then(([u, o]) => { setUser(u); setOrg(o); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, [orgId]);

  async function handleSaveFrigate(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setFrigateLoading(true); setFrigateError(''); setFrigateSuccess(''); setFrigateTestResult(null);
    try {
      await api.patch(`/api/orgs/${orgId}`, { frigateUrl, frigateApiKey, frigateWebhookSecret });
      setFrigateSuccess('Frigate settings saved.');
    } catch (err: unknown) {
      setFrigateError(err instanceof Error ? err.message : 'Failed to save Frigate settings');
    } finally {
      setFrigateLoading(false);
    }
  }

  async function handleTestFrigate() {
    if (!orgId) return;
    setFrigateTestLoading(true); setFrigateTestResult(null);
    try {
      const result = await api.post<{ ok: boolean; version?: string; error?: string }>(
        `/api/orgs/${orgId}/detection/frigate/test`,
        {},
      );
      setFrigateTestResult(result);
    } catch (err: unknown) {
      setFrigateTestResult({ ok: false, error: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setFrigateTestLoading(false);
    }
  }

  async function handleUpdateWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setWebhookLoading(true); setWebhookError(''); setWebhookSuccess('');
    try {
      await api.patch(`/api/orgs/${orgId}`, { discordWebhookUrl: webhookUrl });
      setWebhookSuccess('Discord webhook updated successfully.');
    } catch (err: unknown) {
      setWebhookError(err instanceof Error ? err.message : 'Failed to update webhook');
    } finally {
      setWebhookLoading(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9' }}>Settings</h1>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>Manage your organisation and account</p>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1.25rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {/* Org Info */}
      <div style={card}>
        <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Organisation</h2>
        {loading ? (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Loading…</p>
        ) : org ? (
          <div>
            <InfoRow label="Name" value={org.name} />
            <InfoRow label="Slug" value={org.slug} mono />
            <InfoRow label="Org ID" value={org.id} mono />
          </div>
        ) : (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>
            Org ID: <code style={{ fontFamily: 'monospace', color: '#818cf8' }}>{orgId || '—'}</code>
          </p>
        )}
      </div>

      {/* Discord Webhook */}
      <div style={card}>
        <h2 style={{ margin: '0 0 0.375rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Discord Webhook</h2>
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.8rem', color: '#64748b' }}>
          Set a Discord webhook URL to receive notifications for alerts and important events.
        </p>
        <form onSubmit={handleUpdateWebhook} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div>
            <label style={labelStyle}>Webhook URL</label>
            <input
              style={inputStyle}
              type="url"
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/…"
              onFocus={onFocus}
              onBlur={onBlur}
            />
          </div>
          {webhookError && <p style={{ color: '#f87171', margin: 0, fontSize: '0.8rem' }}>{webhookError}</p>}
          {webhookSuccess && <p style={{ color: '#4ade80', margin: 0, fontSize: '0.8rem' }}>{webhookSuccess}</p>}
          <div>
            <button type="submit" style={btnPrimary} disabled={webhookLoading}>
              {webhookLoading ? 'Saving…' : 'Save Webhook'}
            </button>
          </div>
        </form>
      </div>

      {/* Frigate Detection */}
      <div style={card}>
        <h2 style={{ margin: '0 0 0.375rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Frigate Detection</h2>
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.8rem', color: '#64748b' }}>
          Connect to a Frigate NVR instance to receive camera detection events and trigger alerts.
        </p>
        {orgId && (
          <div style={{ marginBottom: '1.25rem', padding: '0.75rem 0.875rem', background: '#0a0a12', borderRadius: 7, border: '1px solid #1e1e2a' }}>
            <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Webhook URL — paste this into Frigate → Notifications → Webhooks
            </div>
            <code style={{ fontSize: '0.78rem', color: '#818cf8', wordBreak: 'break-all', fontFamily: 'monospace' }}>
              {`${process.env.NEXT_PUBLIC_CONTROL_PLANE_URL || 'http://localhost:3001'}/api/orgs/${orgId}/detection/frigate/webhook`}
            </code>
          </div>
        )}
        <form onSubmit={handleSaveFrigate} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div>
            <label style={labelStyle}>Frigate URL</label>
            <input
              style={inputStyle}
              type="url"
              value={frigateUrl}
              onChange={e => setFrigateUrl(e.target.value)}
              placeholder="http://192.168.1.100:5000"
              onFocus={onFocus}
              onBlur={onBlur}
            />
            <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.3rem' }}>
              Base URL of your Frigate instance (no trailing slash).
            </div>
          </div>
          <div>
            <label style={labelStyle}>API Key <span style={{ color: '#475569' }}>(optional)</span></label>
            <input
              style={inputStyle}
              type="password"
              value={frigateApiKey}
              onChange={e => setFrigateApiKey(e.target.value)}
              placeholder="Leave blank if Frigate auth is disabled"
              onFocus={onFocus}
              onBlur={onBlur}
            />
          </div>
          <div>
            <label style={labelStyle}>Webhook Secret <span style={{ color: '#475569' }}>(optional)</span></label>
            <input
              style={inputStyle}
              type="password"
              value={frigateWebhookSecret}
              onChange={e => setFrigateWebhookSecret(e.target.value)}
              placeholder="Shared secret sent in X-Webhook-Secret header"
              onFocus={onFocus}
              onBlur={onBlur}
            />
            <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.3rem' }}>
              If set, Frigate must send this value in the <code style={{ fontFamily: 'monospace', color: '#818cf8' }}>X-Webhook-Secret</code> header. Leave blank to accept all requests.
            </div>
          </div>
          {frigateError && <p style={{ color: '#f87171', margin: 0, fontSize: '0.8rem' }}>{frigateError}</p>}
          {frigateSuccess && <p style={{ color: '#4ade80', margin: 0, fontSize: '0.8rem' }}>{frigateSuccess}</p>}
          {frigateTestResult && (
            <div style={{
              padding: '0.625rem 0.875rem', borderRadius: 7, fontSize: '0.8rem',
              background: frigateTestResult.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
              border: `1px solid ${frigateTestResult.ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
              color: frigateTestResult.ok ? '#4ade80' : '#f87171',
            }}>
              {frigateTestResult.ok
                ? `Connected — Frigate v${frigateTestResult.version}`
                : `Connection failed: ${frigateTestResult.error}`}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" style={btnPrimary} disabled={frigateLoading}>
              {frigateLoading ? 'Saving…' : 'Save Frigate Settings'}
            </button>
            <button
              type="button"
              style={{ ...btnPrimary, background: '#0f766e', boxShadow: '0 2px 8px rgba(15,118,110,0.25)' }}
              onClick={handleTestFrigate}
              disabled={frigateTestLoading}
            >
              {frigateTestLoading ? 'Testing…' : 'Test Connection'}
            </button>
          </div>
        </form>
      </div>

      {/* Agent Pairing */}
      <div style={card}>
        <h2 style={{ margin: '0 0 0.375rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Agent Pairing</h2>
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.8rem', color: '#64748b' }}>
          To register a new host agent, generate a pairing token from the Hosts page.
        </p>
        <a href="/hosts" style={{ ...btnPrimary, textDecoration: 'none', display: 'inline-block' }}>
          Go to Hosts →
        </a>
      </div>

      {/* Account */}
      <div style={card}>
        <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Account</h2>
        {loading ? (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Loading…</p>
        ) : user ? (
          <div>
            <InfoRow label="Email" value={user.email} />
            {user.name && <InfoRow label="Name" value={user.name} />}
            <InfoRow label="User ID" value={user.id} mono />
            <p style={{ margin: '1rem 0 0', fontSize: '0.78rem', color: '#64748b' }}>
              Account changes are not supported in this version. Contact your administrator to update credentials.
            </p>
          </div>
        ) : (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Could not load user info.</p>
        )}
      </div>
    </div>
  );
}
