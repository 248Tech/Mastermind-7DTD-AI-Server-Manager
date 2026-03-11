'use client';
import { useState, useCallback } from 'react';
import { api, AlertRule } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';
import { usePoll } from '../../../hooks/useRealtime';

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

const btnSecondary: React.CSSProperties = {
  padding: '0.5rem 1rem',
  background: '#fff',
  color: '#1a1a2e',
  border: '1px solid #ccc',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.9rem',
};

function conditionSummary(condition: unknown): string {
  if (!condition) return '—';
  if (typeof condition === 'object' && condition !== null) {
    const c = condition as Record<string, unknown>;
    if (c.type) return String(c.type);
    return JSON.stringify(condition).slice(0, 60);
  }
  return String(condition);
}

function channelSummary(channel: unknown): string {
  if (!channel) return '—';
  if (typeof channel === 'object' && channel !== null) {
    const c = channel as Record<string, unknown>;
    if (c.type && c.webhookUrl) return `${c.type}: ${String(c.webhookUrl).slice(0, 40)}…`;
    if (c.type) return String(c.type);
    return JSON.stringify(channel).slice(0, 60);
  }
  return String(channel);
}

export default function AlertsPage() {
  const orgId = getStoredOrgId();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [error, setError] = useState('');
  const [apiNotice, setApiNotice] = useState('');

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'heartbeat_missed', webhookUrl: '', enabled: true });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Action loading
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    if (!orgId) return [];
    return api.get<AlertRule[]>(`/api/orgs/${orgId}/alerts`);
  }, [orgId]);

  usePoll(
    fetchRules,
    (data) => { setRules(data); setError(''); },
    30000,
    !!orgId,
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setCreateLoading(true);
    setCreateError('');
    setApiNotice('');
    try {
      await api.post<AlertRule>(`/api/orgs/${orgId}/alerts`, {
        name: form.name,
        condition: { type: form.type },
        channel: { type: 'discord', webhookUrl: form.webhookUrl },
        enabled: form.enabled,
      });
      setShowCreate(false);
      setForm({ name: '', type: 'heartbeat_missed', webhookUrl: '', enabled: true });
      const updated = await fetchRules();
      setRules(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create alert rule';
      if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
        setApiNotice('Alert Rules API coming soon — this feature is not yet available on the server.');
      } else {
        setCreateError(msg);
      }
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleToggle(rule: AlertRule) {
    if (!orgId) return;
    setActionLoading(rule.id);
    try {
      await api.patch<AlertRule>(`/api/orgs/${orgId}/alerts/${rule.id}`, { enabled: !rule.enabled });
      const updated = await fetchRules();
      setRules(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update alert rule');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(id: string) {
    if (!orgId) return;
    if (!confirm('Delete this alert rule?')) return;
    setActionLoading(id);
    try {
      await api.delete(`/api/orgs/${orgId}/alerts/${id}`);
      setRules(prev => prev.filter(r => r.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete alert rule');
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 1.5rem', fontSize: '1.6rem', color: '#1a1a2e' }}>Alert Rules</h1>

      {error && (
        <div style={{ background: '#fde8e8', color: '#c00', padding: '0.75rem 1rem', borderRadius: 6, marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>
      )}
      {apiNotice && (
        <div style={{ background: '#fff8e1', color: '#e65c00', padding: '0.75rem 1rem', borderRadius: 6, marginBottom: '1rem', fontSize: '0.9rem', border: '1px solid #ffe0a0' }}>
          {apiNotice}
        </div>
      )}

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', color: '#1a1a2e' }}>Alert Rules</h2>
          <button style={btnPrimary} onClick={() => { setShowCreate(!showCreate); setCreateError(''); setApiNotice(''); }}>
            {showCreate ? 'Cancel' : 'Add Alert Rule'}
          </button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} style={{ background: '#f8f9fa', border: '1px solid #eee', borderRadius: 8, padding: '1.25rem', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>New Alert Rule</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Name *</label>
                <input style={inputStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="Host offline alert" />
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Alert Type *</label>
                <select style={inputStyle} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                  <option value="heartbeat_missed">Heartbeat Missed (host offline)</option>
                </select>
                <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.2rem' }}>
                  Triggers when a host has not sent a heartbeat for an extended period.
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Discord Webhook URL *</label>
                <input
                  style={inputStyle}
                  value={form.webhookUrl}
                  onChange={e => setForm({ ...form, webhookUrl: e.target.value })}
                  required
                  placeholder="https://discord.com/api/webhooks/…"
                  type="url"
                />
                <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.2rem' }}>
                  Notifications will be posted to this Discord channel.
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  id="alertEnabled"
                  checked={form.enabled}
                  onChange={e => setForm({ ...form, enabled: e.target.checked })}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <label htmlFor="alertEnabled" style={{ fontSize: '0.85rem', color: '#555', cursor: 'pointer' }}>Enabled</label>
              </div>
            </div>
            {createError && <p style={{ color: '#c00', fontSize: '0.85rem', margin: '0.75rem 0 0' }}>{createError}</p>}
            <div style={{ marginTop: '1rem', display: 'flex', gap: 8 }}>
              <button type="submit" style={btnPrimary} disabled={createLoading}>
                {createLoading ? 'Saving…' : 'Save Alert Rule'}
              </button>
              <button type="button" style={btnSecondary} onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        )}

        {rules.length === 0 ? (
          <p style={{ color: '#888', fontSize: '0.9rem' }}>No alert rules configured.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name', 'Condition', 'Channel', 'Enabled', 'Created', 'Actions'].map(h => (
                  <th key={h} style={{ background: '#f0f0f0', padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.85rem', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontWeight: 600, fontSize: '0.9rem' }}>{rule.name}</td>
                  <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontSize: '0.85rem', color: '#444' }}>{conditionSummary(rule.condition)}</td>
                  <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontSize: '0.85rem', color: '#444', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{channelSummary(rule.channel)}</td>
                  <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee' }}>
                    <span style={{ display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.8rem', fontWeight: 600, background: rule.enabled ? '#e6f7ed' : '#f0f0f0', color: rule.enabled ? '#1e7e34' : '#666' }}>
                      {rule.enabled ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontSize: '0.8rem', color: '#666' }}>
                    {new Date(rule.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        style={{ ...btnSecondary, fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
                        onClick={() => handleToggle(rule)}
                        disabled={actionLoading === rule.id}
                      >
                        {rule.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        style={{ ...btnSecondary, fontSize: '0.8rem', padding: '0.25rem 0.5rem', borderColor: '#faa', color: '#c00' }}
                        onClick={() => handleDelete(rule.id)}
                        disabled={actionLoading === rule.id}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
