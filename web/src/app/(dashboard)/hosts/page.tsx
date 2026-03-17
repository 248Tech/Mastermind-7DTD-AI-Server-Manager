'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, Host, ServerInstance, PairingToken } from '../../../lib/api';
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

const btnDanger: React.CSSProperties = {
  padding: '0.3rem 0.6rem', background: 'transparent', color: '#f87171',
  border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem',
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
    online:  { bg: 'rgba(34,197,94,0.1)',  color: '#4ade80' },
    offline: { bg: 'rgba(239,68,68,0.1)',  color: '#f87171' },
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

function onFocus(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.target.style.borderColor = '#6366f1';
  e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)';
}
function onBlur(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
  e.target.style.borderColor = '#252532';
  e.target.style.boxShadow = 'none';
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function HostsPage() {
  const orgId = getStoredOrgId();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [servers, setServers] = useState<ServerInstance[]>([]);
  const [loadingHosts, setLoadingHosts] = useState(true);
  const [error, setError] = useState('');

  const [showPairing, setShowPairing] = useState(false);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingToken, setPairingToken] = useState<PairingToken | null>(null);
  const [pairingError, setPairingError] = useState('');

  const [selectedHost, setSelectedHost] = useState<Host | null>(null);

  const [showRegisterServer, setShowRegisterServer] = useState(false);
  const [serverForm, setServerForm] = useState({
    name: '', hostId: '', gameType: '7dtd', installPath: '', startCommand: '',
    telnetHost: '', telnetPort: '', telnetPassword: '',
  });
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerError, setRegisterError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState('');

  const fetchData = useCallback(async () => {
    if (!orgId) return;
    const [h, s] = await Promise.all([
      api.get<Host[]>(`/api/orgs/${orgId}/hosts`),
      api.get<ServerInstance[]>(`/api/orgs/${orgId}/server-instances`),
    ]);
    return { hosts: h, servers: s };
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    fetchData()
      ?.then((data) => {
        if (data) { setHosts(data.hosts); setServers(data.servers); }
        setLoadingHosts(false);
      })
      .catch((err) => { setError(err.message); setLoadingHosts(false); });
  }, [orgId, fetchData]);

  usePoll(
    async () => { if (!orgId) return null; return fetchData(); },
    (data) => { if (data) { setHosts(data.hosts); setServers(data.servers); } },
    10000, !!orgId,
  );

  async function handleGeneratePairingToken() {
    if (!orgId) return;
    setPairingLoading(true); setPairingError(''); setPairingToken(null);
    try {
      const token = await api.post<PairingToken>(`/api/orgs/${orgId}/pairing-tokens`, {});
      setPairingToken(token);
    } catch (err: unknown) {
      setPairingError(err instanceof Error ? err.message : 'Failed to generate token');
    } finally {
      setPairingLoading(false);
    }
  }

  async function handleRegisterServer(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setRegisterLoading(true); setRegisterError(''); setRegisterSuccess('');
    try {
      await api.post<ServerInstance>(`/api/orgs/${orgId}/server-instances`, {
        name: serverForm.name,
        hostId: serverForm.hostId || undefined,
        gameType: serverForm.gameType,
        installPath: serverForm.installPath || null,
        startCommand: serverForm.startCommand || null,
        telnetHost: serverForm.telnetHost || null,
        telnetPort: serverForm.telnetPort ? parseInt(serverForm.telnetPort) : null,
        telnetPassword: serverForm.telnetPassword || null,
      });
      setRegisterSuccess('Server instance registered successfully.');
      setServerForm({ name: '', hostId: '', gameType: '7dtd', installPath: '', startCommand: '', telnetHost: '', telnetPort: '', telnetPassword: '' });
      const updated = await fetchData();
      if (updated) { setHosts(updated.hosts); setServers(updated.servers); }
    } catch (err: unknown) {
      setRegisterError(err instanceof Error ? err.message : 'Failed to register server');
    } finally {
      setRegisterLoading(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9' }}>Hosts</h1>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>Manage host machines and server instances</p>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1.25rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {/* Hosts Table */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Registered Hosts</h2>
          <button style={btnPrimary} onClick={() => { setShowPairing(!showPairing); setPairingToken(null); setPairingError(''); }}>
            {showPairing ? 'Cancel' : '+ Pair New Host'}
          </button>
        </div>

        {showPairing && (
          <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, padding: '1.25rem', marginBottom: '1.25rem' }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', fontWeight: 600, color: '#f1f5f9' }}>Generate Pairing Token</h3>
            <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#94a3b8' }}>
              Run the host agent with this token to register a new host. Expires in 10 minutes.
            </p>
            <button style={btnPrimary} onClick={handleGeneratePairingToken} disabled={pairingLoading}>
              {pairingLoading ? 'Generating…' : 'Generate Token'}
            </button>
            {pairingError && <p style={{ color: '#f87171', fontSize: '0.8rem', marginTop: '0.5rem', margin: '0.5rem 0 0' }}>{pairingError}</p>}
            {pairingToken && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.375rem' }}>
                  Token (expires {new Date(pairingToken.expiresAt).toLocaleTimeString()}):
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '0.875rem' }}>
                  <code style={{ background: '#0a0a0f', border: '1px solid #252532', color: '#818cf8', padding: '0.5rem 0.875rem', borderRadius: 7, fontSize: '0.8rem', flex: 1, wordBreak: 'break-all', fontFamily: 'monospace' }}>
                    {pairingToken.token}
                  </code>
                  <button style={btnSecondary} onClick={() => navigator.clipboard.writeText(pairingToken.token)}>
                    Copy
                  </button>
                </div>
                <div style={{ background: '#0a0a0f', border: '1px solid #1e1e2a', borderRadius: 7, padding: '0.875rem 1rem' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Next: start the agent on your server</div>
                  <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.375rem' }}>1. Copy <code style={{ color: '#818cf8' }}>agent/config.yaml.example</code> to <code style={{ color: '#818cf8' }}>config.yaml</code> and set:</div>
                  <code style={{ display: 'block', fontSize: '0.78rem', color: '#818cf8', background: '#111118', padding: '0.4rem 0.6rem', borderRadius: 5, marginBottom: '0.5rem', whiteSpace: 'pre' }}>{`control_plane_url: "http://<this-machine-ip>:3001"\npairing_token: "${pairingToken.token}"`}</code>
                  <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>2. Build and run: <code style={{ color: '#818cf8' }}>go run . -config=config.yaml</code></div>
                </div>
              </div>
            )}
          </div>
        )}

        {loadingHosts ? (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Loading…</p>
        ) : hosts.length === 0 ? (
          <div style={{ padding: '1.25rem', background: '#0d0d14', borderRadius: 8, border: '1px dashed #252532' }}>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: '#94a3b8', fontWeight: 500 }}>No hosts registered yet.</p>
            <ol style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.82rem', color: '#64748b', lineHeight: 1.7 }}>
              <li>Click <strong style={{ color: '#e2e8f0' }}>+ Pair New Host</strong> above, then click <strong style={{ color: '#e2e8f0' }}>Generate Token</strong>.</li>
              <li>Copy the token and set it as <code style={{ color: '#818cf8' }}>pairing_token</code> in your agent&apos;s <code style={{ color: '#818cf8' }}>config.yaml</code>.</li>
              <li>Start the agent: <code style={{ color: '#818cf8' }}>./mastermind-agent -config=config.yaml</code></li>
              <li>The host will appear here once the agent connects.</li>
            </ol>
          </div>
        ) : (
          <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #1e1e2a' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Name', 'Status', 'Agent Version', 'Last Heartbeat', 'Servers', 'Actions'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hosts.map((host) => (
                  <tr key={host.id}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{host.name}</td>
                    <td style={tdStyle}><Badge status={host.status} /></td>
                    <td style={{ ...tdStyle, color: '#64748b' }}>{host.agentVersion ? <code style={{ background: '#1e1e2a', padding: '0.15rem 0.4rem', borderRadius: 4, fontSize: '0.8rem' }}>v{host.agentVersion}</code> : '—'}</td>
                    <td style={{ ...tdStyle, color: '#64748b' }}>{formatRelative(host.lastHeartbeatAt)}</td>
                    <td style={{ ...tdStyle, color: '#94a3b8' }}>{host.serverInstances.length}</td>
                    <td style={tdStyle}>
                      <button
                        style={{ ...btnSecondary, fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
                        onClick={() => setSelectedHost(selectedHost?.id === host.id ? null : host)}
                      >
                        {selectedHost?.id === host.id ? 'Hide' : 'Details'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Host Detail Panel */}
      {selectedHost && (
        <div style={card}>
          <h2 style={{ margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>
            Host: {selectedHost.name}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            {[
              { label: 'ID', value: selectedHost.id, mono: true },
              { label: 'Status', value: null, badge: selectedHost.status },
              { label: 'Agent Version', value: selectedHost.agentVersion || '—' },
              { label: 'Last Heartbeat', value: selectedHost.lastHeartbeatAt ? new Date(selectedHost.lastHeartbeatAt).toLocaleString() : '—' },
            ].map((item) => (
              <div key={item.label} style={{ background: '#0d0d14', borderRadius: 7, padding: '0.875rem 1rem', border: '1px solid #1e1e2a' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.label}</div>
                {item.badge ? <Badge status={item.badge} /> : (
                  <div style={{ fontSize: '0.85rem', color: '#e2e8f0', fontFamily: item.mono ? 'monospace' : undefined, wordBreak: 'break-all' }}>
                    {item.value}
                  </div>
                )}
              </div>
            ))}
          </div>

          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Server Instances</h3>
          {selectedHost.serverInstances.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: '0.875rem' }}>No server instances on this host.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {selectedHost.serverInstances.map((si) => {
                const full = servers.find(s => s.id === si.id);
                return (
                  <div key={si.id} style={{ background: '#0d0d14', borderRadius: 7, padding: '0.875rem 1rem', border: '1px solid #1e1e2a' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#f1f5f9' }}>{si.name}</div>
                    {full && (
                      <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.25rem' }}>
                        {full.gameType} · {full.installPath || 'No install path'} · Telnet: {full.telnetHost ? `${full.telnetHost}:${full.telnetPort}` : 'Not configured'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {selectedHost.lastMetrics && (
            <>
              <h3 style={{ margin: '1.25rem 0 0.75rem', fontSize: '0.875rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Last Metrics</h3>
              <pre style={{ background: '#0a0a0f', border: '1px solid #1e1e2a', padding: '0.875rem', borderRadius: 7, fontSize: '0.8rem', overflow: 'auto', margin: 0, color: '#94a3b8' }}>
                {JSON.stringify(selectedHost.lastMetrics, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}

      {/* Server Instances */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Server Instances</h2>
          <button style={btnPrimary} onClick={() => setShowRegisterServer(!showRegisterServer)}>
            {showRegisterServer ? 'Cancel' : '+ Register Server'}
          </button>
        </div>

        {showRegisterServer && (
          <form onSubmit={handleRegisterServer} style={{ background: '#0d0d14', border: '1px solid #1e1e2a', borderRadius: 8, padding: '1.25rem', marginBottom: '1.25rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '0.9rem', fontWeight: 600, color: '#f1f5f9' }}>New Server Instance</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
              {[
                { label: 'Name *', key: 'name', placeholder: 'My 7DTD Server', required: true },
                { label: 'Install Path', key: 'installPath', placeholder: '/opt/7dtd' },
                { label: 'Start Command', key: 'startCommand', placeholder: './startserver.sh' },
                { label: 'Telnet Host', key: 'telnetHost', placeholder: '127.0.0.1' },
                { label: 'Telnet Port', key: 'telnetPort', placeholder: '8081', type: 'number' },
                { label: 'Telnet Password', key: 'telnetPassword', placeholder: 'Optional', type: 'password' },
              ].map((f) => (
                <div key={f.key}>
                  <label style={labelStyle}>{f.label}</label>
                  <input
                    style={inputStyle}
                    type={f.type || 'text'}
                    placeholder={f.placeholder}
                    required={f.required}
                    value={(serverForm as Record<string, string>)[f.key]}
                    onChange={e => setServerForm({ ...serverForm, [f.key]: e.target.value })}
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                </div>
              ))}
              <div>
                <label style={labelStyle}>Host</label>
                <select style={inputStyle} value={serverForm.hostId} onChange={e => setServerForm({ ...serverForm, hostId: e.target.value })} onFocus={onFocus} onBlur={onBlur}>
                  <option value="">— Select Host —</option>
                  {hosts.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Game Type *</label>
                <select style={inputStyle} value={serverForm.gameType} onChange={e => setServerForm({ ...serverForm, gameType: e.target.value })} onFocus={onFocus} onBlur={onBlur}>
                  <option value="7dtd">7 Days to Die</option>
                  <option value="minecraft">Minecraft</option>
                </select>
              </div>
            </div>
            {registerError && <p style={{ color: '#f87171', fontSize: '0.8rem', margin: '0.875rem 0 0' }}>{registerError}</p>}
            {registerSuccess && <p style={{ color: '#4ade80', fontSize: '0.8rem', margin: '0.875rem 0 0' }}>{registerSuccess}</p>}
            <div style={{ marginTop: '1rem', display: 'flex', gap: 8 }}>
              <button type="submit" style={btnPrimary} disabled={registerLoading}>
                {registerLoading ? 'Registering…' : 'Register Server'}
              </button>
              <button type="button" style={btnSecondary} onClick={() => setShowRegisterServer(false)}>Cancel</button>
            </div>
          </form>
        )}

        {servers.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>No server instances registered.</p>
        ) : (
          <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #1e1e2a' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Name', 'Game', 'Host', 'Install Path', 'Telnet'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {servers.map((s) => {
                  const host = hosts.find(h => h.id === s.hostId);
                  return (
                    <tr key={s.id}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{s.name}</td>
                      <td style={tdStyle}>
                        <code style={{ background: '#1e1e2a', padding: '0.15rem 0.5rem', borderRadius: 4, fontSize: '0.8rem', color: '#94a3b8' }}>{s.gameType}</code>
                      </td>
                      <td style={{ ...tdStyle, color: '#94a3b8' }}>{host?.name || s.hostId || '—'}</td>
                      <td style={{ ...tdStyle, color: '#64748b', fontFamily: 'monospace', fontSize: '0.8rem' }}>{s.installPath || '—'}</td>
                      <td style={{ ...tdStyle, color: '#64748b' }}>{s.telnetHost ? `${s.telnetHost}:${s.telnetPort}` : '—'}</td>
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
