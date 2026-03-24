'use client';
import { useState, useCallback } from 'react';
import { api, Schedule, ServerInstance } from '../../../lib/api';
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

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span style={{ color: '#3f3f52' }}>—</span>;
  const s = status.toLowerCase();
  const map: Record<string, { bg: string; color: string }> = {
    success:   { bg: 'rgba(34,197,94,0.1)',  color: '#4ade80' },
    completed: { bg: 'rgba(34,197,94,0.1)',  color: '#4ade80' },
    failed:    { bg: 'rgba(239,68,68,0.1)',  color: '#f87171' },
    error:     { bg: 'rgba(239,68,68,0.1)',  color: '#f87171' },
    running:   { bg: 'rgba(56,189,248,0.1)', color: '#38bdf8' },
  };
  const { bg, color } = map[s] || { bg: 'rgba(100,116,139,0.1)', color: '#64748b' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.6rem', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600, background: bg, color }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {s}
    </span>
  );
}

function onFocus(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.target.style.borderColor = '#6366f1';
  e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)';
}
function onBlur(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.target.style.borderColor = '#252532';
  e.target.style.boxShadow = 'none';
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString();
}

const JOB_TYPES = ['SERVER_START', 'SERVER_STOP', 'SERVER_RESTART'];

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function SchedulesPage() {
  const orgId = getStoredOrgId();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [servers, setServers] = useState<ServerInstance[]>([]);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', serverInstanceId: '', cronExpression: '', jobType: 'SERVER_START', enabled: true });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchSchedules = useCallback(async () => {
    if (!orgId) return [];
    return api.get<Schedule[]>(`/api/orgs/${orgId}/schedules`);
  }, [orgId]);

  const fetchServers = useCallback(async () => {
    if (!orgId) return [];
    return api.get<ServerInstance[]>(`/api/orgs/${orgId}/server-instances`);
  }, [orgId]);

  usePoll(fetchSchedules, (data) => { setSchedules(data); setError(''); }, 15000, !!orgId);
  usePoll(fetchServers, (data) => setServers(data), 60000, !!orgId);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setCreateLoading(true); setCreateError('');
    try {
      await api.post<Schedule>(`/api/orgs/${orgId}/schedules`, {
        name: form.name, serverInstanceId: form.serverInstanceId || undefined,
        cronExpression: form.cronExpression, jobType: form.jobType, enabled: form.enabled,
      });
      setShowCreate(false);
      setForm({ name: '', serverInstanceId: '', cronExpression: '', jobType: 'SERVER_START', enabled: true });
      const updated = await fetchSchedules();
      setSchedules(updated);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create schedule');
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleToggle(schedule: Schedule) {
    if (!orgId) return;
    setActionLoading(schedule.id);
    try {
      await api.patch<Schedule>(`/api/orgs/${orgId}/schedules/${schedule.id}`, { enabled: !schedule.enabled });
      const updated = await fetchSchedules();
      setSchedules(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update schedule');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(id: string) {
    if (!orgId) return;
    if (!confirm('Delete this schedule?')) return;
    setActionLoading(id);
    try {
      await api.delete(`/api/orgs/${orgId}/schedules/${id}`);
      setSchedules(prev => prev.filter(s => s.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete schedule');
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9' }}>Schedules</h1>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>Automatically run jobs on a cron schedule — nightly restarts, daily backups, etc.</p>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1.25rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Scheduled Jobs</h2>
          <button style={btnPrimary} onClick={() => { setShowCreate(!showCreate); setCreateError(''); }}>
            {showCreate ? 'Cancel' : '+ Add Schedule'}
          </button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} style={{ background: '#0d0d14', border: '1px solid #1e1e2a', borderRadius: 8, padding: '1.25rem', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '0.9rem', fontWeight: 600, color: '#f1f5f9' }}>New Schedule</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
              <div>
                <label style={labelStyle}>Name *</label>
                <input style={inputStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="Daily restart" onFocus={onFocus} onBlur={onBlur} />
              </div>
              <div>
                <label style={labelStyle}>Server Instance</label>
                <select style={inputStyle} value={form.serverInstanceId} onChange={e => setForm({ ...form, serverInstanceId: e.target.value })} onFocus={onFocus} onBlur={onBlur}>
                  <option value="">— Select Server —</option>
                  {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Cron Expression *</label>
                <input style={inputStyle} value={form.cronExpression} onChange={e => setForm({ ...form, cronExpression: e.target.value })} required placeholder="0 4 * * *" onFocus={onFocus} onBlur={onBlur} />
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.3rem' }}>
                  e.g. <code style={{ color: '#818cf8' }}>0 4 * * *</code> = daily at 4 AM
                </div>
              </div>
              <div>
                <label style={labelStyle}>Job Type *</label>
                <select style={inputStyle} value={form.jobType} onChange={e => setForm({ ...form, jobType: e.target.value })} onFocus={onFocus} onBlur={onBlur}>
                  {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="checkbox"
                  id="enabled"
                  checked={form.enabled}
                  onChange={e => setForm({ ...form, enabled: e.target.checked })}
                  style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#6366f1' }}
                />
                <label htmlFor="enabled" style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer' }}>Enabled</label>
              </div>
            </div>
            {createError && <p style={{ color: '#f87171', fontSize: '0.8rem', margin: '0.875rem 0 0' }}>{createError}</p>}
            <div style={{ marginTop: '1rem', display: 'flex', gap: 8 }}>
              <button type="submit" style={btnPrimary} disabled={createLoading}>
                {createLoading ? 'Saving…' : 'Save Schedule'}
              </button>
              <button type="button" style={btnSecondary} onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        )}

        {schedules.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>No schedules configured.</p>
        ) : (
          <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #1e1e2a' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Name', 'Server', 'Cron', 'Type', 'Enabled', 'Next Run', 'Last Run', 'Status', 'Actions'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedules.map((sched) => {
                  const server = servers.find(s => s.id === sched.serverInstanceId);
                  return (
                    <tr key={sched.id}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{sched.name}</td>
                      <td style={{ ...tdStyle, color: '#94a3b8' }}>{server?.name || sched.serverInstanceId || '—'}</td>
                      <td style={tdStyle}>
                        <code style={{ background: '#1e1e2a', padding: '0.15rem 0.5rem', borderRadius: 4, fontSize: '0.78rem', color: '#818cf8', fontFamily: 'monospace' }}>{sched.cronExpression}</code>
                      </td>
                      <td style={tdStyle}>
                        <code style={{ background: '#1e1e2a', padding: '0.15rem 0.5rem', borderRadius: 4, fontSize: '0.78rem', color: '#94a3b8' }}>{sched.jobType}</code>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.6rem', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600, background: sched.enabled ? 'rgba(34,197,94,0.1)' : 'rgba(100,116,139,0.1)', color: sched.enabled ? '#4ade80' : '#64748b' }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: sched.enabled ? '#4ade80' : '#64748b', display: 'inline-block' }} />
                          {sched.enabled ? 'On' : 'Off'}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, color: '#64748b', fontSize: '0.8rem' }}>{formatDateTime(sched.nextRunAt)}</td>
                      <td style={{ ...tdStyle, color: '#64748b', fontSize: '0.8rem' }}>{formatDateTime(sched.lastRunAt)}</td>
                      <td style={tdStyle}><StatusBadge status={sched.lastRunStatus} /></td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button style={btnSmall} onClick={() => handleToggle(sched)} disabled={actionLoading === sched.id}>
                            {sched.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button style={btnDangerSmall} onClick={() => handleDelete(sched.id)} disabled={actionLoading === sched.id}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
