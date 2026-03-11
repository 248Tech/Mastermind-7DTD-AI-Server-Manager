'use client';
import { useState, useCallback } from 'react';
import { api, Host, Job } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';
import { usePoll } from '../../../hooks/useRealtime';

const card: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: '1.5rem',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  marginBottom: '1rem',
};

function statusBadge(status: string | null) {
  const s = (status || 'unknown').toLowerCase();
  let style: React.CSSProperties = { display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.8rem', fontWeight: 600 };
  if (s === 'online') style = { ...style, background: '#e6f7ed', color: '#1e7e34' };
  else if (s === 'offline') style = { ...style, background: '#fde8e8', color: '#c00' };
  else style = { ...style, background: '#f0f0f0', color: '#666' };
  return <span style={style}>{s}</span>;
}

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

export default function DashboardPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState('');

  const orgId = getStoredOrgId();

  const fetchAll = useCallback(async () => {
    if (!orgId) return { hosts: [], jobs: [] };
    const [h, j] = await Promise.all([
      api.get<Host[]>(`/api/orgs/${orgId}/hosts`),
      api.get<Job[]>(`/api/orgs/${orgId}/jobs?limit=5`),
    ]);
    return { hosts: h, jobs: j };
  }, [orgId]);

  usePoll(
    fetchAll,
    (data) => {
      setHosts(data.hosts);
      setJobs(data.jobs);
      setError('');
    },
    10000,
    !!orgId,
  );

  const onlineHosts = hosts.filter(h => h.status === 'online').length;
  const offlineHosts = hosts.filter(h => h.status === 'offline').length;

  return (
    <div>
      <h1 style={{ margin: '0 0 1.5rem', fontSize: '1.6rem', color: '#1a1a2e' }}>Dashboard</h1>

      {error && (
        <div style={{ background: '#fde8e8', color: '#c00', padding: '0.75rem 1rem', borderRadius: 6, marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>
      )}

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Total Hosts', value: hosts.length, color: '#1a1a2e' },
          { label: 'Online', value: onlineHosts, color: '#1e7e34' },
          { label: 'Offline', value: offlineHosts, color: '#c00' },
          { label: 'Recent Jobs', value: jobs.length, color: '#4a6fa5' },
        ].map((stat) => (
          <div key={stat.label} style={{ ...card, marginBottom: 0, textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.25rem' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Recent Jobs */}
      <div style={card}>
        <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem', color: '#1a1a2e' }}>Recent Jobs</h2>
        {jobs.length === 0 ? (
          <p style={{ color: '#888', fontSize: '0.9rem', margin: 0 }}>No recent jobs.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Server', 'Type', 'Status', 'Started', 'Duration'].map(h => (
                  <th key={h} style={{ background: '#f0f0f0', padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.85rem', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontSize: '0.9rem' }}>{job.serverName || job.serverInstanceId || '—'}</td>
                  <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontSize: '0.9rem' }}>{job.type}</td>
                  <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee' }}>{jobStatusBadge(job.latestRun?.status ?? null)}</td>
                  <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontSize: '0.85rem', color: '#666' }}>{formatRelative(job.latestRun?.startedAt ?? null)}</td>
                  <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontSize: '0.85rem', color: '#666' }}>{formatDuration(job.latestRun?.startedAt ?? null, job.latestRun?.finishedAt ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Hosts Status */}
      <div style={card}>
        <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem', color: '#1a1a2e' }}>Hosts</h2>
        {hosts.length === 0 ? (
          <p style={{ color: '#888', fontSize: '0.9rem', margin: 0 }}>No hosts registered. <a href="/hosts" style={{ color: '#4a6fa5' }}>Add a host</a>.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {hosts.map((host) => (
              <div key={host.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: '#f8f9fa', borderRadius: 6, border: '1px solid #eee' }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{host.name}</span>
                  {host.agentVersion && (
                    <span style={{ marginLeft: 8, fontSize: '0.8rem', color: '#888' }}>v{host.agentVersion}</span>
                  )}
                  <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.2rem' }}>
                    {host.serverInstances.length} server{host.serverInstances.length !== 1 ? 's' : ''} &bull; Last seen: {formatRelative(host.lastHeartbeatAt)}
                  </div>
                </div>
                {statusBadge(host.status)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
