'use client';
import React, { useState, useCallback } from 'react';
import { api, Job, ServerInstance } from '../../../lib/api';
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

function Badge({ status }: { status: string | null }) {
  const s = (status || 'unknown').toLowerCase();
  const map: Record<string, { bg: string; color: string }> = {
    success:   { bg: 'rgba(34,197,94,0.1)',  color: '#4ade80' },
    completed: { bg: 'rgba(34,197,94,0.1)',  color: '#4ade80' },
    failed:    { bg: 'rgba(239,68,68,0.1)',  color: '#f87171' },
    error:     { bg: 'rgba(239,68,68,0.1)',  color: '#f87171' },
    pending:   { bg: 'rgba(245,158,11,0.1)', color: '#fbbf24' },
    running:   { bg: 'rgba(56,189,248,0.1)', color: '#38bdf8' },
  };
  const { bg, color } = map[s] || { bg: 'rgba(100,116,139,0.1)', color: '#64748b' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
      padding: '0.2rem 0.6rem', borderRadius: 20,
      fontSize: '0.75rem', fontWeight: 600, background: bg, color,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {s}
    </span>
  );
}

function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt) return '—';
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const secs = Math.round((end - start) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function onFocus(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
  e.target.style.borderColor = '#6366f1';
  e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)';
}
function onBlur(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
  e.target.style.borderColor = '#252532';
  e.target.style.boxShadow = 'none';
}

const JOB_TYPES = ['start', 'stop', 'restart', 'rcon', 'custom'];

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function JobsPage() {
  const orgId = getStoredOrgId();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [servers, setServers] = useState<ServerInstance[]>([]);
  const [serversLoaded, setServersLoaded] = useState(false);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ serverInstanceId: '', type: 'start', command: '', customPayload: '' });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    if (!orgId) return [];
    return api.get<Job[]>(`/api/orgs/${orgId}/jobs`);
  }, [orgId]);

  const fetchServers = useCallback(async () => {
    if (!orgId) return;
    try {
      const s = await api.get<ServerInstance[]>(`/api/orgs/${orgId}/server-instances`);
      setServers(s);
      setServersLoaded(true);
    } catch { /* ignore */ }
  }, [orgId]);

  usePoll(fetchJobs, (data) => { setJobs(data); setError(''); }, 5000, !!orgId);
  usePoll(fetchServers, () => {}, 60000, !!orgId && !serversLoaded);

  async function handleCreateJob(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setCreateLoading(true); setCreateError('');
    try {
      let payload: Record<string, unknown> = {};
      if (form.type === 'rcon') {
        payload = { command: form.command };
      } else if (form.type === 'custom') {
        try {
          payload = form.customPayload ? JSON.parse(form.customPayload) : {};
        } catch {
          setCreateError('Custom payload must be valid JSON');
          setCreateLoading(false);
          return;
        }
      }
      await api.post<Job>(`/api/orgs/${orgId}/jobs`, {
        serverInstanceId: form.serverInstanceId || undefined,
        type: form.type, payload,
      });
      setShowCreate(false);
      setForm({ serverInstanceId: '', type: 'start', command: '', customPayload: '' });
      const updated = await fetchJobs();
      setJobs(updated);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create job');
    } finally {
      setCreateLoading(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9' }}>Jobs</h1>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>Queue and monitor server operations</p>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1.25rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Job History</h2>
          <button style={btnPrimary} onClick={() => { setShowCreate(!showCreate); setCreateError(''); }}>
            {showCreate ? 'Cancel' : '+ Create Job'}
          </button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreateJob} style={{ background: '#0d0d14', border: '1px solid #1e1e2a', borderRadius: 8, padding: '1.25rem', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '0.9rem', fontWeight: 600, color: '#f1f5f9' }}>New Job</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
              <div>
                <label style={labelStyle}>Server Instance</label>
                <select style={inputStyle} value={form.serverInstanceId} onChange={e => setForm({ ...form, serverInstanceId: e.target.value })} onFocus={onFocus} onBlur={onBlur}>
                  <option value="">— Select Server (optional) —</option>
                  {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Job Type *</label>
                <select style={inputStyle} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} required onFocus={onFocus} onBlur={onBlur}>
                  {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {form.type === 'rcon' && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>RCON Command *</label>
                  <input style={inputStyle} value={form.command} onChange={e => setForm({ ...form, command: e.target.value })} required={form.type === 'rcon'} placeholder="e.g. listplayers" onFocus={onFocus} onBlur={onBlur} />
                </div>
              )}
              {form.type === 'custom' && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Payload (JSON)</label>
                  <textarea
                    style={{ ...inputStyle, fontFamily: 'monospace', minHeight: 80, resize: 'vertical' }}
                    value={form.customPayload}
                    onChange={e => setForm({ ...form, customPayload: e.target.value })}
                    placeholder='{}'
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                </div>
              )}
            </div>
            {createError && <p style={{ color: '#f87171', fontSize: '0.8rem', margin: '0.875rem 0 0' }}>{createError}</p>}
            <div style={{ marginTop: '1rem', display: 'flex', gap: 8 }}>
              <button type="submit" style={btnPrimary} disabled={createLoading}>
                {createLoading ? 'Creating…' : 'Create Job'}
              </button>
              <button type="button" style={btnSecondary} onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        )}

        {jobs.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>No jobs yet.</p>
        ) : (
          <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #1e1e2a' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Server', 'Type', 'Status', 'Created', 'Duration', 'Output'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <React.Fragment key={job.id}>
                    <tr>
                      <td style={{ ...tdStyle, fontWeight: 500, borderBottom: expandedJob === job.id ? 'none' : '1px solid #1a1a24' }}>
                        {job.serverName || (job.serverInstanceId ? servers.find(s => s.id === job.serverInstanceId)?.name || job.serverInstanceId : '—')}
                      </td>
                      <td style={{ ...tdStyle, borderBottom: expandedJob === job.id ? 'none' : '1px solid #1a1a24' }}>
                        <code style={{ background: '#1e1e2a', padding: '0.15rem 0.5rem', borderRadius: 4, fontSize: '0.8rem', color: '#94a3b8' }}>{job.type}</code>
                      </td>
                      <td style={{ ...tdStyle, borderBottom: expandedJob === job.id ? 'none' : '1px solid #1a1a24' }}><Badge status={job.latestRun?.status ?? null} /></td>
                      <td style={{ ...tdStyle, color: '#64748b', borderBottom: expandedJob === job.id ? 'none' : '1px solid #1a1a24' }}>{formatRelative(job.createdAt)}</td>
                      <td style={{ ...tdStyle, color: '#64748b', borderBottom: expandedJob === job.id ? 'none' : '1px solid #1a1a24' }}>{formatDuration(job.latestRun?.startedAt ?? null, job.latestRun?.finishedAt ?? null)}</td>
                      <td style={{ ...tdStyle, borderBottom: expandedJob === job.id ? 'none' : '1px solid #1a1a24' }}>
                        {job.latestRun?.result ? (
                          <button
                            style={{ background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', fontSize: '0.8rem', padding: 0, textDecoration: 'underline', textUnderlineOffset: 3 }}
                            onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
                          >
                            {expandedJob === job.id ? 'Hide' : 'View'}
                          </button>
                        ) : (
                          <span style={{ color: '#3f3f52', fontSize: '0.85rem' }}>—</span>
                        )}
                      </td>
                    </tr>
                    {expandedJob === job.id && Boolean(job.latestRun?.result) && (
                      <tr>
                        <td colSpan={6} style={{ padding: '0 1rem 1rem', borderBottom: '1px solid #1a1a24' }}>
                          <pre style={{ background: '#0a0a0f', border: '1px solid #1e1e2a', color: '#94a3b8', padding: '0.875rem', borderRadius: 7, fontSize: '0.8rem', overflow: 'auto', margin: 0, maxHeight: 200 }}>
                            {(() => { const r = job.latestRun?.result; return typeof r === 'string' ? r : JSON.stringify(r as Record<string, unknown>, null, 2); })()}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
