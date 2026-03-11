'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, Host, ServerInstance, PairingToken } from '../../../lib/api';
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
  const s = (status || 'unknown').toLowerCase();
  let style: React.CSSProperties = { display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.8rem', fontWeight: 600 };
  if (s === 'online') style = { ...style, background: '#e6f7ed', color: '#1e7e34' };
  else if (s === 'offline') style = { ...style, background: '#fde8e8', color: '#c00' };
  else style = { ...style, background: '#f0f0f0', color: '#666' };
  return <span style={style}>{s}</span>;
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

export default function HostsPage() {
  const orgId = getStoredOrgId();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [servers, setServers] = useState<ServerInstance[]>([]);
  const [loadingHosts, setLoadingHosts] = useState(true);
  const [error, setError] = useState('');

  // Pairing token
  const [showPairing, setShowPairing] = useState(false);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingToken, setPairingToken] = useState<PairingToken | null>(null);
  const [pairingError, setPairingError] = useState('');

  // Selected host detail
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);

  // Register server form
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
        if (data) {
          setHosts(data.hosts);
          setServers(data.servers);
        }
        setLoadingHosts(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoadingHosts(false);
      });
  }, [orgId, fetchData]);

  usePoll(
    async () => {
      if (!orgId) return null;
      return fetchData();
    },
    (data) => {
      if (data) {
        setHosts(data.hosts);
        setServers(data.servers);
      }
    },
    10000,
    !!orgId,
  );

  async function handleGeneratePairingToken() {
    if (!orgId) return;
    setPairingLoading(true);
    setPairingError('');
    setPairingToken(null);
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
    setRegisterLoading(true);
    setRegisterError('');
    setRegisterSuccess('');
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
      if (updated) {
        setHosts(updated.hosts);
        setServers(updated.servers);
      }
    } catch (err: unknown) {
      setRegisterError(err instanceof Error ? err.message : 'Failed to register server');
    } finally {
      setRegisterLoading(false);
    }
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 1.5rem', fontSize: '1.6rem', color: '#1a1a2e' }}>Hosts</h1>

      {error && (
        <div style={{ background: '#fde8e8', color: '#c00', padding: '0.75rem 1rem', borderRadius: 6, marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>
      )}

      {/* Hosts Table */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', color: '#1a1a2e' }}>Registered Hosts</h2>
          <button
            style={btnPrimary}
            onClick={() => { setShowPairing(!showPairing); setPairingToken(null); setPairingError(''); }}
          >
            {showPairing ? 'Cancel' : 'Pair New Host'}
          </button>
        </div>

        {showPairing && (
          <div style={{ background: '#f0f4ff', border: '1px solid #c0d0ff', borderRadius: 8, padding: '1.25rem', marginBottom: '1rem' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Generate Pairing Token</h3>
            <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: '#555' }}>
              Run the host agent with this token to register a new host. The token expires in 10 minutes.
            </p>
            <button style={btnPrimary} onClick={handleGeneratePairingToken} disabled={pairingLoading}>
              {pairingLoading ? 'Generating…' : 'Generate Token'}
            </button>
            {pairingError && <p style={{ color: '#c00', fontSize: '0.85rem', marginTop: '0.5rem' }}>{pairingError}</p>}
            {pairingToken && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ fontSize: '0.85rem', color: '#555', marginBottom: '0.25rem' }}>
                  Pairing Token (expires {new Date(pairingToken.expiresAt).toLocaleTimeString()}):
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <code style={{ background: '#1a1a2e', color: '#e0e0ff', padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.85rem', flex: 1, wordBreak: 'break-all' }}>
                    {pairingToken.token}
                  </code>
                  <button
                    style={btnSecondary}
                    onClick={() => navigator.clipboard.writeText(pairingToken.token)}
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {loadingHosts ? (
          <p style={{ color: '#888', fontSize: '0.9rem' }}>Loading…</p>
        ) : hosts.length === 0 ? (
          <p style={{ color: '#888', fontSize: '0.9rem' }}>No hosts registered yet. Use &quot;Pair New Host&quot; to add one.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name', 'Status', 'Agent Version', 'Last Heartbeat', 'Servers', 'Actions'].map(h => (
                  <th key={h} style={{ background: '#f0f0f0', padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.85rem', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hosts.map((host) => (
                <tr key={host.id}>
                  <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontWeight: 600, fontSize: '0.9rem' }}>{host.name}</td>
                  <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee' }}>{statusBadge(host.status)}</td>
                  <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontSize: '0.85rem', color: '#666' }}>{host.agentVersion || '—'}</td>
                  <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontSize: '0.85rem', color: '#666' }}>{formatRelative(host.lastHeartbeatAt)}</td>
                  <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontSize: '0.85rem', color: '#666' }}>{host.serverInstances.length}</td>
                  <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee' }}>
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
        )}
      </div>

      {/* Host Detail Panel */}
      {selectedHost && (
        <div style={card}>
          <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem', color: '#1a1a2e' }}>
            Host: {selectedHost.name}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: '0.2rem' }}>ID</div>
              <div style={{ fontSize: '0.85rem', fontFamily: 'monospace' }}>{selectedHost.id}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: '0.2rem' }}>Status</div>
              <div>{statusBadge(selectedHost.status)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: '0.2rem' }}>Agent Version</div>
              <div style={{ fontSize: '0.85rem' }}>{selectedHost.agentVersion || '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: '0.2rem' }}>Last Heartbeat</div>
              <div style={{ fontSize: '0.85rem' }}>{selectedHost.lastHeartbeatAt ? new Date(selectedHost.lastHeartbeatAt).toLocaleString() : '—'}</div>
            </div>
          </div>

          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Server Instances on this Host</h3>
          {selectedHost.serverInstances.length === 0 ? (
            <p style={{ color: '#888', fontSize: '0.85rem' }}>No server instances on this host.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {selectedHost.serverInstances.map((si) => {
                const full = servers.find(s => s.id === si.id);
                return (
                  <div key={si.id} style={{ background: '#f8f9fa', borderRadius: 6, padding: '0.75rem 1rem', border: '1px solid #eee' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{si.name}</div>
                    {full && (
                      <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem' }}>
                        {full.gameType} &bull; {full.installPath || 'No install path'} &bull; Telnet: {full.telnetHost ? `${full.telnetHost}:${full.telnetPort}` : 'Not configured'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {selectedHost.lastMetrics && (
            <>
              <h3 style={{ margin: '1rem 0 0.75rem', fontSize: '1rem' }}>Last Metrics</h3>
              <pre style={{ background: '#f0f0f0', padding: '0.75rem', borderRadius: 6, fontSize: '0.8rem', overflow: 'auto', margin: 0 }}>
                {JSON.stringify(selectedHost.lastMetrics, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}

      {/* Server Instances List */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', color: '#1a1a2e' }}>Server Instances</h2>
          <button style={btnPrimary} onClick={() => setShowRegisterServer(!showRegisterServer)}>
            {showRegisterServer ? 'Cancel' : 'Register Server'}
          </button>
        </div>

        {showRegisterServer && (
          <form onSubmit={handleRegisterServer} style={{ background: '#f8f9fa', border: '1px solid #eee', borderRadius: 8, padding: '1.25rem', marginBottom: '1rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>Register Server Instance</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Name *</label>
                <input style={inputStyle} value={serverForm.name} onChange={e => setServerForm({ ...serverForm, name: e.target.value })} required placeholder="My 7DTD Server" />
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Host</label>
                <select style={inputStyle} value={serverForm.hostId} onChange={e => setServerForm({ ...serverForm, hostId: e.target.value })}>
                  <option value="">— Select Host —</option>
                  {hosts.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Game Type *</label>
                <select style={inputStyle} value={serverForm.gameType} onChange={e => setServerForm({ ...serverForm, gameType: e.target.value })}>
                  <option value="7dtd">7 Days to Die</option>
                  <option value="minecraft">Minecraft</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Install Path</label>
                <input style={inputStyle} value={serverForm.installPath} onChange={e => setServerForm({ ...serverForm, installPath: e.target.value })} placeholder="/opt/7dtd" />
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Start Command</label>
                <input style={inputStyle} value={serverForm.startCommand} onChange={e => setServerForm({ ...serverForm, startCommand: e.target.value })} placeholder="./startserver.sh" />
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Telnet Host</label>
                <input style={inputStyle} value={serverForm.telnetHost} onChange={e => setServerForm({ ...serverForm, telnetHost: e.target.value })} placeholder="127.0.0.1" />
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Telnet Port</label>
                <input style={inputStyle} type="number" value={serverForm.telnetPort} onChange={e => setServerForm({ ...serverForm, telnetPort: e.target.value })} placeholder="8081" />
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', color: '#555', display: 'block', marginBottom: '0.25rem' }}>Telnet Password</label>
                <input style={inputStyle} type="password" value={serverForm.telnetPassword} onChange={e => setServerForm({ ...serverForm, telnetPassword: e.target.value })} placeholder="Optional" />
              </div>
            </div>
            {registerError && <p style={{ color: '#c00', fontSize: '0.85rem', margin: '0.75rem 0 0' }}>{registerError}</p>}
            {registerSuccess && <p style={{ color: '#1e7e34', fontSize: '0.85rem', margin: '0.75rem 0 0' }}>{registerSuccess}</p>}
            <div style={{ marginTop: '1rem', display: 'flex', gap: 8 }}>
              <button type="submit" style={btnPrimary} disabled={registerLoading}>
                {registerLoading ? 'Registering…' : 'Register Server'}
              </button>
              <button type="button" style={btnSecondary} onClick={() => setShowRegisterServer(false)}>Cancel</button>
            </div>
          </form>
        )}

        {servers.length === 0 ? (
          <p style={{ color: '#888', fontSize: '0.9rem' }}>No server instances registered.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name', 'Game', 'Host', 'Install Path', 'Telnet'].map(h => (
                  <th key={h} style={{ background: '#f0f0f0', padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.85rem', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {servers.map((s) => {
                const host = hosts.find(h => h.id === s.hostId);
                return (
                  <tr key={s.id}>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontWeight: 600, fontSize: '0.9rem' }}>{s.name}</td>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontSize: '0.85rem' }}>{s.gameType}</td>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontSize: '0.85rem', color: '#666' }}>{host?.name || s.hostId || '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontSize: '0.85rem', color: '#666' }}>{s.installPath || '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee', fontSize: '0.85rem', color: '#666' }}>
                      {s.telnetHost ? `${s.telnetHost}:${s.telnetPort}` : '—'}
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
