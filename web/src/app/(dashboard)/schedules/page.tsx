'use client';
import { useState, useCallback } from 'react';
import { api, Schedule, ServerInstance } from '../../../lib/api';
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

function statusBadge(status: string | null) {
  if (!status) return <span style={{ color: '#999', fontSize: '0.85rem' }}>—</span>;
  const s = status.toLowerCase();
  let style: React.CSSProperties = { display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.8rem', fontWeight: 600 };
  if (s === 'success' || s === 'completed') style = { ...style, background: '#e6f7ed', color: '#1e7e34' };
  else if (s === 'failed' || s === 'error') style = { ...style, background: '#fde8e8', color: '#c00' };
  else if (s === 'running') style = { ...style, background: '#e8f0fe', color: '#1a73e8' };
  else style = { ...style, background: '#f0f0f0', color: '#666' };
  return <span style={style}>{s}</span>;
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString();
}

const JOB_TYPES = ['start', 'stop', 'restart', 'rcon', 'custom'];

export default function SchedulesPage() {
  const orgId = getStoredOrgId();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [servers, setServers] = useState<ServerInstance[]>([]);
  const [error, setError] = useState('');
  const [apiNotice, setApiNotice] = useState('');

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', serverInstanceId: '', cronExpression: '', jobType: 'start', enabled: true });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Toggle/delete loading
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchSchedules = useCallback(async () => {
    if (!orgId) return [];
    return api.get<Schedule[]>(`/api/orgs/${orgId}/schedules`);
  }, [orgId]);

  const fetchServers = useCallback(async () => {
    if (!orgId) return [];
    return api.get<ServerInstance[]>(`/api/orgs/${orgId}/server-instances`);
  }, [orgId]);

  usePoll(
    fetchSchedules,
    (data) => { setSchedules(data); setError(''); },
    15000,
    !!orgId,
  );

  usePoll(
    fetchServers,
    (data) => setServers(data),
    60000,
    !!orgId,
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setCreateLoading(true);
    setCreateError('');
    setApiNotice('');
    try {
      await api.post<Schedule>(`/api/orgs/${orgId}/schedules`, {
        name: form.name,
        serverInstanceId: form.serverInstanceId || undefined,
        cronExpression: form.cronExpression,
        jobType: form.jobType,
        enabled: form.enabled,
      });
      setShowCreate(false);
      setForm({ name: '', serverInstanceId: '', cronExpression: '', jobType: 'start', enabled: true });
      const updated = await fetchSchedules();
      setSchedules(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create schedule';
      if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
        setApiNotice('Schedules API coming soon — this feature is not yet available on the server.');
      } else {
        setCreateError(msg);
      }
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
      <h1 style={{ margin: '0 0 1.5rem', fontSize: '1.6rem', color: '#1a1a2e' }}>Schedules</h1>

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
          <h2 style={{ margin: 0, fontSize: '1.1rem', color: '#1a1a2e' }}>Scheduled Jobs</h2>
          <button style={btnPrimary} onClick={() => { setShowCreate(!showCreate); setCreateError(''); setApiNotice(''); }}>
            {showCreate ? 'Cancel' : 'Add Schedule'}
          </button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} style={{ background: '#f8f9fa', border: '1px solid #eee', borderRadius: 8, padding: '1.25rem', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>New Schedule</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Name *</label>
                <input style={inputStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="Daily restart" />
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Server Instance</label>
                <select style={inputStyle} value={form.serverInstanceId} onChange={e => setForm({ ...form, serverInstanceId: e.target.value })}>
                  <option value="">— Select Server —</option>
                  {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Cron Expression *</label>
                <input style={inputStyle} value={form.cronExpression} onChange={e => setForm({ ...form, cronExpression: e.target.value })} required placeholder="0 4 * * *" />
                <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.2rem' }}>e.g. <code>0 4 * * *</code> = daily at 4 AM</div>
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Job Type *</label>
                <select style={inputStyle} value={form.jobType} onChange={e => setForm({ ...form, jobType: e.target.value })}>
                  {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  id="enabled"
                  checked={form.enabled}
                  onChange={e => setForm({ ...form, enabled: e.target.checked })}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <label htmlFor="enabled" style={{ fontSize: '0.85rem', color: '#555', cursor: 'pointer' }}>Enabled</label>
              </div>
            </div>
            {createError && <p style={{ color: '#c00', fontSize: '0.85rem', margin: '0.75rem 0 0' }}>{createError}</p>}
            <div style={{ marginTop: '1rem', display: 'flex', gap: 8 }}>
              <button type="submit" style={btnPrimary} disabled={createLoading}>
                {createLoading ? 'Saving…' : 'Save Schedule'}
              </button>
              <button type="button" style={btnSecondary} onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        )}

        {schedules.length === 0 ? (
          <p style={{ color: '#888', fontSize: '0.9rem' }}>No schedules configured.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name', 'Server', 'Cron', 'Job Type', 'Enabled', 'Next Run', 'Last Run', 'Last Status', 'Actions'].map(h => (
                  <th key={h} style={{ background: '#f0f0f0', padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.85rem', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedules.map((sched) => {
                const server = servers.find(s => s.id === sched.serverInstanceId);
                return (
                  <tr key={sched.id}>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontWeight: 600, fontSize: '0.9rem' }}>{sched.name}</td>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontSize: '0.85rem', color: '#666' }}>{server?.name || sched.serverInstanceId || '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontSize: '0.85rem', fontFamily: 'monospace' }}>{sched.cronExpression}</td>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontSize: '0.85rem' }}>{sched.jobType}</td>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee' }}>
                      <span style={{ display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.8rem', fontWeight: 600, background: sched.enabled ? '#e6f7ed' : '#f0f0f0', color: sched.enabled ? '#1e7e34' : '#666' }}>
                        {sched.enabled ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontSize: '0.8rem', color: '#666' }}>{formatDateTime(sched.nextRunAt)}</td>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontSize: '0.8rem', color: '#666' }}>{formatDateTime(sched.lastRunAt)}</td>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee' }}>{statusBadge(sched.lastRunStatus)}</td>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          style={{ ...btnSecondary, fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
                          onClick={() => handleToggle(sched)}
                          disabled={actionLoading === sched.id}
                        >
                          {sched.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          style={{ ...btnSecondary, fontSize: '0.8rem', padding: '0.25rem 0.5rem', borderColor: '#faa', color: '#c00' }}
                          onClick={() => handleDelete(sched.id)}
                          disabled={actionLoading === sched.id}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
