'use client';
import React, { useState, useCallback } from 'react';
import { api, Job, ServerInstance } from '../../../lib/api';
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

function jobStatusBadge(status: string | null) {
  const s = (status || 'unknown').toLowerCase();
  let style: React.CSSProperties = { display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.8rem', fontWeight: 600 };
  if (s === 'success' || s === 'completed') style = { ...style, background: '#e6f7ed', color: '#1e7e34' };
  else if (s === 'failed' || s === 'error') style = { ...style, background: '#fde8e8', color: '#c00' };
  else if (s === 'pending') style = { ...style, background: '#fff8e1', color: '#e65c00' };
  else if (s === 'running') style = { ...style, background: '#e8f0fe', color: '#1a73e8' };
  else style = { ...style, background: '#f0f0f0', color: '#666' };
  return <span style={style}>{s}</span>;
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

function resultSnippet(result: unknown): string {
  if (!result) return '—';
  const s = typeof result === 'string' ? result : JSON.stringify(result);
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
}

const JOB_TYPES = ['start', 'stop', 'restart', 'rcon', 'custom'];

export default function JobsPage() {
  const orgId = getStoredOrgId();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [servers, setServers] = useState<ServerInstance[]>([]);
  const [serversLoaded, setServersLoaded] = useState(false);
  const [error, setError] = useState('');

  // Create job form
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ serverInstanceId: '', type: 'start', command: '', customPayload: '' });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Expanded job output
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
    } catch {
      // ignore
    }
  }, [orgId]);

  usePoll(
    fetchJobs,
    (data) => {
      setJobs(data);
      setError('');
    },
    5000,
    !!orgId,
  );

  // Load servers once
  usePoll(fetchServers, () => {}, 60000, !!orgId && !serversLoaded);

  async function handleCreateJob(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setCreateLoading(true);
    setCreateError('');
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
        type: form.type,
        payload,
      });
      setShowCreate(false);
      setForm({ serverInstanceId: '', type: 'start', command: '', customPayload: '' });
      // Refresh jobs immediately
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
      <h1 style={{ margin: '0 0 1.5rem', fontSize: '1.6rem', color: '#1a1a2e' }}>Jobs</h1>

      {error && (
        <div style={{ background: '#fde8e8', color: '#c00', padding: '0.75rem 1rem', borderRadius: 6, marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>
      )}

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', color: '#1a1a2e' }}>Job History</h2>
          <button style={btnPrimary} onClick={() => { setShowCreate(!showCreate); setCreateError(''); }}>
            {showCreate ? 'Cancel' : 'Create Job'}
          </button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreateJob} style={{ background: '#f8f9fa', border: '1px solid #eee', borderRadius: 8, padding: '1.25rem', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>Create Job</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Server Instance</label>
                <select style={inputStyle} value={form.serverInstanceId} onChange={e => setForm({ ...form, serverInstanceId: e.target.value })}>
                  <option value="">— Select Server (optional) —</option>
                  {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Job Type *</label>
                <select style={inputStyle} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} required>
                  {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {form.type === 'rcon' && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>RCON Command *</label>
                  <input style={inputStyle} value={form.command} onChange={e => setForm({ ...form, command: e.target.value })} required={form.type === 'rcon'} placeholder="e.g. listplayers" />
                </div>
              )}
              {form.type === 'custom' && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Payload (JSON)</label>
                  <textarea
                    style={{ ...inputStyle, fontFamily: 'monospace', minHeight: 80, resize: 'vertical' }}
                    value={form.customPayload}
                    onChange={e => setForm({ ...form, customPayload: e.target.value })}
                    placeholder='{}'
                  />
                </div>
              )}
            </div>
            {createError && <p style={{ color: '#c00', fontSize: '0.85rem', margin: '0.75rem 0 0' }}>{createError}</p>}
            <div style={{ marginTop: '1rem', display: 'flex', gap: 8 }}>
              <button type="submit" style={btnPrimary} disabled={createLoading}>
                {createLoading ? 'Creating…' : 'Create Job'}
              </button>
              <button type="button" style={btnSecondary} onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        )}

        {jobs.length === 0 ? (
          <p style={{ color: '#888', fontSize: '0.9rem' }}>No jobs yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Server', 'Type', 'Status', 'Created', 'Duration', 'Output'].map(h => (
                  <th key={h} style={{ background: '#f0f0f0', padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.85rem', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <React.Fragment key={job.id}>
                  <tr>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: expandedJob === job.id ? 'none' : '1px solid #eee', fontSize: '0.9rem' }}>
                      {job.serverName || (job.serverInstanceId ? servers.find(s => s.id === job.serverInstanceId)?.name || job.serverInstanceId : '—')}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: expandedJob === job.id ? 'none' : '1px solid #eee', fontSize: '0.9rem' }}>{job.type}</td>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: expandedJob === job.id ? 'none' : '1px solid #eee' }}>{jobStatusBadge(job.latestRun?.status ?? null)}</td>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: expandedJob === job.id ? 'none' : '1px solid #eee', fontSize: '0.85rem', color: '#666' }}>{formatRelative(job.createdAt)}</td>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: expandedJob === job.id ? 'none' : '1px solid #eee', fontSize: '0.85rem', color: '#666' }}>{formatDuration(job.latestRun?.startedAt ?? null, job.latestRun?.finishedAt ?? null)}</td>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: expandedJob === job.id ? 'none' : '1px solid #eee' }}>
                      {job.latestRun?.result ? (
                        <button
                          style={{ background: 'none', border: 'none', color: '#4a6fa5', cursor: 'pointer', fontSize: '0.85rem', padding: 0 }}
                          onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
                        >
                          {expandedJob === job.id ? 'Hide' : 'View'}
                        </button>
                      ) : (
                        <span style={{ color: '#ccc', fontSize: '0.85rem' }}>—</span>
                      )}
                    </td>
                  </tr>
                  {expandedJob === job.id && job.latestRun?.result && (
                    <tr>
                      <td colSpan={6} style={{ padding: '0 0.75rem 0.75rem', borderBottom: '1px solid #eee' }}>
                        <pre style={{ background: '#1a1a2e', color: '#e0e0ff', padding: '0.75rem', borderRadius: 6, fontSize: '0.8rem', overflow: 'auto', margin: 0, maxHeight: 200 }}>
                          {typeof job.latestRun.result === 'string' ? job.latestRun.result : JSON.stringify(job.latestRun.result, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
