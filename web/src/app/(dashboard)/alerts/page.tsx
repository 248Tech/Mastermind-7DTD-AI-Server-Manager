'use client';
import { useState, useCallback } from 'react';
import { api, AlertRule } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';
import { usePoll } from '../../../hooks/useRealtime';

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

const btnSecondary: React.CSSProperties = {
  padding: '0.5rem 1.125rem', background: 'transparent', color: '#94a3b8',
  border: '1px solid #252532', borderRadius: 7, cursor: 'pointer', fontSize: '0.875rem',
};

const btnSmall: React.CSSProperties = {
  padding: '0.25rem 0.625rem', background: 'transparent', color: '#94a3b8',
  border: '1px solid #252532', borderRadius: 5, cursor: 'pointer', fontSize: '0.78rem',
};

const btnDangerSmall: React.CSSProperties = {
  ...btnSmall, color: '#f87171', borderColor: 'rgba(239,68,68,0.3)',
};

const thStyle: React.CSSProperties = {
  padding: '0.625rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600,
  color: '#64748b', letterSpacing: '0.04em', textTransform: 'uppercase',
  background: '#0d0d14', borderBottom: '1px solid #1e1e2a',
};

const tdStyle: React.CSSProperties = {
  padding: '0.75rem 1rem', fontSize: '0.875rem', borderBottom: '1px solid #1a1a24', color: '#e2e8f0',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.3rem', fontWeight: 500,
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

function onFocus(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.target.style.borderColor = '#6366f1';
  e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)';
}
function onBlur(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.target.style.borderColor = '#252532';
  e.target.style.boxShadow = 'none';
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AlertsPage() {
  const orgId = getStoredOrgId();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [error, setError] = useState('');
  const [apiNotice, setApiNotice] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'heartbeat_missed', webhookUrl: '', enabled: true });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    if (!orgId) return [];
    return api.get<AlertRule[]>(`/api/orgs/${orgId}/alerts`);
  }, [orgId]);

  usePoll(fetchRules, (data) => { setRules(data); setError(''); }, 30000, !!orgId);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setCreateLoading(true); setCreateError(''); setApiNotice('');
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
        setApiNotice('Alert Rules endpoint not found on the control plane. Verify backend version and API URL in settings.');
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
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9' }}>Alert Rules</h1>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>Get notified via Discord when a server goes offline or crosses a threshold</p>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1.25rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}
      {apiNotice && (
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#fbbf24', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1.25rem', fontSize: '0.875rem' }}>
          {apiNotice}
        </div>
      )}

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Alert Rules</h2>
          <button style={btnPrimary} onClick={() => { setShowCreate(!showCreate); setCreateError(''); setApiNotice(''); }}>
            {showCreate ? 'Cancel' : '+ Add Alert Rule'}
          </button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} style={{ background: '#0d0d14', border: '1px solid #1e1e2a', borderRadius: 8, padding: '1.25rem', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '0.9rem', fontWeight: 600, color: '#f1f5f9' }}>New Alert Rule</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <div>
                <label style={labelStyle}>Name *</label>
                <input style={inputStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="Host offline alert" onFocus={onFocus} onBlur={onBlur} />
              </div>
              <div>
                <label style={labelStyle}>Alert Type *</label>
                <select style={inputStyle} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} onFocus={onFocus} onBlur={onBlur}>
                  <option value="heartbeat_missed">Heartbeat Missed (host offline)</option>
                </select>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.3rem' }}>
                  Triggers when a host has not sent a heartbeat for an extended period.
                </div>
              </div>
              <div>
                <label style={labelStyle}>Discord Webhook URL *</label>
                <input
                  style={inputStyle}
                  value={form.webhookUrl}
                  onChange={e => setForm({ ...form, webhookUrl: e.target.value })}
                  required
                  placeholder="https://discord.com/api/webhooks/…"
                  type="url"
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.3rem' }}>
                  Notifications will be posted to this Discord channel.
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="checkbox"
                  id="alertEnabled"
                  checked={form.enabled}
                  onChange={e => setForm({ ...form, enabled: e.target.checked })}
                  style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#6366f1' }}
                />
                <label htmlFor="alertEnabled" style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer' }}>Enabled</label>
              </div>
            </div>
            {createError && <p style={{ color: '#f87171', fontSize: '0.8rem', margin: '0.875rem 0 0' }}>{createError}</p>}
            <div style={{ marginTop: '1rem', display: 'flex', gap: 8 }}>
              <button type="submit" style={btnPrimary} disabled={createLoading}>
                {createLoading ? 'Saving…' : 'Save Alert Rule'}
              </button>
              <button type="button" style={btnSecondary} onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        )}

        {rules.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>No alert rules configured.</p>
        ) : (
          <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #1e1e2a' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Name', 'Condition', 'Channel', 'Enabled', 'Created', 'Actions'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{rule.name}</td>
                    <td style={tdStyle}>
                      <code style={{ background: '#1e1e2a', padding: '0.15rem 0.5rem', borderRadius: 4, fontSize: '0.78rem', color: '#94a3b8' }}>{conditionSummary(rule.condition)}</code>
                    </td>
                    <td style={{ ...tdStyle, color: '#94a3b8', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                      {channelSummary(rule.channel)}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.6rem', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600, background: rule.enabled ? 'rgba(34,197,94,0.1)' : 'rgba(100,116,139,0.1)', color: rule.enabled ? '#4ade80' : '#64748b' }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: rule.enabled ? '#4ade80' : '#64748b', display: 'inline-block' }} />
                        {rule.enabled ? 'On' : 'Off'}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: '#64748b', fontSize: '0.8rem' }}>
                      {new Date(rule.createdAt).toLocaleDateString()}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button style={btnSmall} onClick={() => handleToggle(rule)} disabled={actionLoading === rule.id}>
                          {rule.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button style={btnDangerSmall} onClick={() => handleDelete(rule.id)} disabled={actionLoading === rule.id}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
