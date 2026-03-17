'use client';
import { useState, useCallback } from 'react';
import { api, Host, Job } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';
import { usePoll } from '../../../hooks/useRealtime';

// ─── Design tokens ────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: '#111118',
  borderRadius: 10,
  padding: '1.5rem',
  border: '1px solid #1e1e2a',
  marginBottom: '1rem',
};

function Badge({ status }: { status: string | null }) {
  const s = (status || 'unknown').toLowerCase();
  const map: Record<string, { bg: string; color: string }> = {
    online:    { bg: 'rgba(34,197,94,0.1)',   color: '#4ade80' },
    offline:   { bg: 'rgba(239,68,68,0.1)',   color: '#f87171' },
    success:   { bg: 'rgba(34,197,94,0.1)',   color: '#4ade80' },
    completed: { bg: 'rgba(34,197,94,0.1)',   color: '#4ade80' },
    failed:    { bg: 'rgba(239,68,68,0.1)',   color: '#f87171' },
    error:     { bg: 'rgba(239,68,68,0.1)',   color: '#f87171' },
    pending:   { bg: 'rgba(245,158,11,0.1)',  color: '#fbbf24' },
    running:   { bg: 'rgba(56,189,248,0.1)',  color: '#38bdf8' },
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

const thStyle: React.CSSProperties = {
  padding: '0.625rem 1rem',
  textAlign: 'left',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#64748b',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  background: '#0d0d14',
  borderBottom: '1px solid #1e1e2a',
};

const tdStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  fontSize: '0.875rem',
  borderBottom: '1px solid #1a1a24',
  color: '#e2e8f0',
};

// ─── Page ─────────────────────────────────────────────────────────────────────
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
    (data) => { setHosts(data.hosts); setJobs(data.jobs); setError(''); },
    10000,
    !!orgId,
  );

  const onlineHosts = hosts.filter(h => h.status === 'online').length;
  const offlineHosts = hosts.filter(h => h.status === 'offline').length;

  const stats = [
    { label: 'Total Hosts',  value: hosts.length, accent: '#818cf8', icon: '⬡' },
    { label: 'Online',       value: onlineHosts,  accent: '#4ade80', icon: '◉' },
    { label: 'Offline',      value: offlineHosts, accent: '#f87171', icon: '○' },
    { label: 'Recent Jobs',  value: jobs.length,  accent: '#38bdf8', icon: '⚡' },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9' }}>Dashboard</h1>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>Overview of your server infrastructure</p>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1.25rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        {stats.map((stat) => (
          <div key={stat.label} style={{
            ...card,
            marginBottom: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
          }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: `${stat.accent}18`,
              border: `1px solid ${stat.accent}30`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.1rem',
              color: stat.accent,
              flexShrink: 0,
            }}>{stat.icon}</div>
            <div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: stat.accent, lineHeight: 1 }}>{stat.value}</div>
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.2rem' }}>{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Jobs */}
      <div style={card}>
        <h2 style={{ margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Recent Jobs</h2>
        {jobs.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '0.875rem', margin: 0 }}>No recent jobs.</p>
        ) : (
          <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #1e1e2a' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Server', 'Type', 'Status', 'Started', 'Duration'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} style={{ background: 'transparent' }}>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{job.serverName || job.serverInstanceId || '—'}</td>
                    <td style={tdStyle}>
                      <code style={{ background: '#1e1e2a', padding: '0.15rem 0.5rem', borderRadius: 4, fontSize: '0.8rem', color: '#94a3b8' }}>{job.type}</code>
                    </td>
                    <td style={tdStyle}><Badge status={job.latestRun?.status ?? null} /></td>
                    <td style={{ ...tdStyle, color: '#64748b' }}>{formatRelative(job.latestRun?.startedAt ?? null)}</td>
                    <td style={{ ...tdStyle, color: '#64748b' }}>{formatDuration(job.latestRun?.startedAt ?? null, job.latestRun?.finishedAt ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Onboarding guide — shown until first host appears */}
      {hosts.length === 0 && (
        <div style={{ ...card, border: '1px solid rgba(99,102,241,0.25)', background: 'rgba(99,102,241,0.04)' }}>
          <h2 style={{ margin: '0 0 0.375rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Quick Setup</h2>
          <p style={{ margin: '0 0 1.25rem', fontSize: '0.83rem', color: '#64748b' }}>
            No hosts yet. Follow these steps to connect your first game server.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            {[
              { n: '1', title: 'Generate a pairing token', desc: 'Go to Hosts → Pair New Host and click "Generate Token". Copy the token shown.', href: '/hosts', cta: 'Go to Hosts →' },
              { n: '2', title: 'Install and run the agent', desc: 'On your game server, build the Go agent and run it with the pairing token. See agent/README.md for details.', code: './mastermind-agent -config=config.yaml' },
              { n: '3', title: 'Register a server instance', desc: 'Once the agent is online, use Hosts → Register Server to define the game server path and connection details.', href: '/hosts', cta: 'Register Server →' },
              { n: '4', title: 'Create your first job', desc: 'Go to Jobs and click "+ Create Job" to start, stop, or restart your server remotely.', href: '/jobs', cta: 'Create a Job →' },
            ].map((step) => (
              <div key={step.n} style={{
                display: 'flex', gap: '1rem', alignItems: 'flex-start',
                padding: '0.875rem 1rem', background: '#0d0d14',
                borderRadius: 8, border: '1px solid #1e1e2a',
              }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.75rem', fontWeight: 700, color: '#818cf8', flexShrink: 0, marginTop: 1,
                }}>{step.n}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#e2e8f0' }}>{step.title}</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.2rem' }}>{step.desc}</div>
                  {step.code && (
                    <code style={{ display: 'inline-block', marginTop: '0.375rem', background: '#0a0a0f', border: '1px solid #252532', padding: '0.2rem 0.5rem', borderRadius: 5, fontSize: '0.78rem', color: '#94a3b8' }}>{step.code}</code>
                  )}
                  {step.href && (
                    <a href={step.href} style={{ display: 'inline-block', marginTop: '0.375rem', fontSize: '0.8rem', color: '#818cf8', textDecoration: 'none' }}>{step.cta}</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hosts */}
      <div style={card}>
        <h2 style={{ margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Hosts</h2>
        {hosts.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '0.875rem', margin: 0 }}>
            No hosts registered yet. Follow the Quick Setup guide above.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {hosts.map((host) => (
              <div key={host.id} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.875rem 1rem',
                background: '#0d0d14',
                borderRadius: 8,
                border: '1px solid #1e1e2a',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: host.status === 'online' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                    border: `1px solid ${host.status === 'online' ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.875rem',
                    color: host.status === 'online' ? '#4ade80' : '#f87171',
                  }}>⬡</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#f1f5f9' }}>
                      {host.name}
                      {host.agentVersion && (
                        <span style={{ marginLeft: 8, fontSize: '0.75rem', color: '#64748b', fontWeight: 400 }}>v{host.agentVersion}</span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.15rem' }}>
                      {host.serverInstances.length} server{host.serverInstances.length !== 1 ? 's' : ''} · Last seen {formatRelative(host.lastHeartbeatAt)}
                    </div>
                  </div>
                </div>
                <Badge status={host.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
