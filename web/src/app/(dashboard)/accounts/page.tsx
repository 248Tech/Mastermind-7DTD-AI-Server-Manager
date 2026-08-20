'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, OrgAccount } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';

const card: React.CSSProperties = { background: '#111118', border: '1px solid #1e1e2a', borderRadius: 10, padding: '1.25rem', marginBottom: '1rem' };
const input: React.CSSProperties = { width: '100%', padding: '.6rem .8rem', borderRadius: 7, border: '1px solid #252532', background: '#0d0d14', color: '#f1f5f9' };
const label: React.CSSProperties = { display: 'block', fontSize: '.78rem', color: '#94a3b8', marginBottom: '.3rem' };
const button: React.CSSProperties = { padding: '.55rem 1rem', border: 0, borderRadius: 7, background: '#6366f1', color: 'white', fontWeight: 600, cursor: 'pointer' };
const cell: React.CSSProperties = { padding: '.7rem', borderBottom: '1px solid #1e1e2a' };

export default function AccountsPage() {
  const orgId = getStoredOrgId();
  const [accounts, setAccounts] = useState<OrgAccount[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busyId, setBusyId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<'operator' | 'viewer'>('operator');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [rows, profile] = await Promise.all([
        api.get<OrgAccount[]>(`/api/orgs/${orgId}/accounts`),
        api.get<{ userId: string }>('/api/auth/me'),
      ]);
      setAccounts(rows);
      setCurrentUserId(profile.userId);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load accounts');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(''); setSuccess('');
    if (password.length < 12) return setError('Password must be at least 12 characters.');
    if (password !== confirmPassword) return setError('Passwords do not match.');
    if (!orgId) return;
    setSaving(true);
    try {
      const created = await api.post<OrgAccount>(`/api/orgs/${orgId}/accounts`, { name, email, password, role });
      setAccounts(current => [...current, created]);
      setName(''); setEmail(''); setPassword(''); setConfirmPassword('');
      setSuccess(`${created.email} was created and approved as ${created.role}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create account');
    } finally { setSaving(false); }
  }

  async function setApproval(account: OrgAccount, approved: boolean) {
    if (!orgId || account.id === currentUserId || account.role === 'admin') return;
    if (!approved && !confirm(`Suspend dashboard access for ${account.email}?\n\nExisting sessions will stop working immediately.`)) return;
    setBusyId(account.id); setError(''); setSuccess('');
    try {
      const result = await api.patch<{ approvedAt: string | null }>(`/api/orgs/${orgId}/accounts/${account.id}/approval`, { approved });
      setAccounts(current => current.map(row => row.id === account.id ? { ...row, approvedAt: result.approvedAt } : row));
      setSuccess(`${account.email} was ${approved ? 'approved' : 'suspended'}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change account approval');
    } finally { setBusyId(''); }
  }

  async function resetPassword(account: OrgAccount) {
    if (!orgId || account.id === currentUserId || account.role === 'admin') return;
    const next = prompt(`Enter a new password for ${account.email}.\n\nMinimum 12 characters.`);
    if (next === null) return;
    if (next.length < 12) return setError('Password must be at least 12 characters.');
    const confirmation = prompt('Enter the new password again to confirm:');
    if (confirmation !== next) return setError('Passwords do not match.');
    setBusyId(account.id); setError(''); setSuccess('');
    try {
      await api.patch(`/api/orgs/${orgId}/accounts/${account.id}/password`, { newPassword: next });
      setSuccess(`${account.email}'s password was reset and existing sessions were revoked.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reset password');
    } finally { setBusyId(''); }
  }

  async function remove(account: OrgAccount) {
    if (!orgId || account.id === currentUserId) return;
    if (!confirm(`Delete organization account "${account.email}"?\n\nAccess is removed immediately. Historical attribution is retained.`)) return;
    setBusyId(account.id); setError(''); setSuccess('');
    try {
      await api.delete(`/api/orgs/${orgId}/accounts/${account.id}`);
      setAccounts(current => current.filter(row => row.id !== account.id));
      setSuccess(`${account.email} was removed.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete account');
    } finally { setBusyId(''); }
  }

  function status(account: OrgAccount) {
    if (!account.signInEnabled) return 'Sign-in disabled';
    if (!account.emailVerifiedAt) return 'Awaiting email';
    if (!account.approvedAt) return 'Awaiting approval';
    return 'Approved';
  }

  return <div>
    <div style={{ marginBottom: '1.5rem' }}><h1 style={{ margin: 0, fontSize: '1.5rem' }}>Accounts</h1><p style={{ color: '#64748b', margin: '.3rem 0 0' }}>Approve registrations and manage organization access.</p></div>
    <div style={card}>
      <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Create approved account</h2>
      <p style={{ color: '#94a3b8', fontSize: '.82rem' }}>Accounts created by an administrator are email-confirmed and approved immediately.</p>
      <form onSubmit={create} style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12 }}>
        <div><label style={label}>Display name</label><input style={input} value={name} onChange={event => setName(event.target.value)} /></div>
        <div><label style={label}>Email</label><input style={input} type="email" value={email} onChange={event => setEmail(event.target.value)} required /></div>
        <div><label style={label}>Password</label><input style={input} type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={12} maxLength={128} required /></div>
        <div><label style={label}>Confirm password</label><input style={input} type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} minLength={12} maxLength={128} required /></div>
        <div><label style={label}>Access level</label><select style={input} value={role} onChange={event => setRole(event.target.value as 'operator' | 'viewer')}><option value="operator">Operator — server controls</option><option value="viewer">Viewer — read only</option></select></div>
        <div style={{ alignSelf: 'end' }}><button style={button} disabled={saving}>{saving ? 'Creating…' : 'Create account'}</button></div>
      </form>
    </div>
    {error && <p style={{ color: '#f87171' }}>{error}</p>}{success && <p style={{ color: '#4ade80' }}>{success}</p>}
    <div style={card}>
      <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Organization accounts</h2>
      <p style={{ color: '#64748b', fontSize: '.78rem' }}>Public registrations stay locked until approved. Suspending approval revokes existing sessions immediately.</p>
      {loading ? <p>Loading…</p> : <div style={{ overflowX: 'auto' }}><table><thead><tr>{['Name', 'Email', 'Access', 'Steam link', 'Status', 'Created', 'Actions'].map(heading => <th key={heading} style={{ ...cell, textAlign: 'left', color: '#64748b', fontSize: '.75rem' }}>{heading}</th>)}</tr></thead><tbody>{accounts.map(account => {
        const protectedAccount = account.id === currentUserId || account.role === 'admin';
        const approvalDisabled = protectedAccount || !account.emailVerifiedAt || !account.signInEnabled || Boolean(busyId);
        return <tr key={account.id}>
          <td style={cell}>{account.name || '—'}{account.id === currentUserId && <small style={{ color: '#818cf8', marginLeft: 6 }}>(you)</small>}</td>
          <td style={cell}>{account.email}</td><td style={{ ...cell, textTransform: 'capitalize' }}>{account.role}</td>
          <td style={{ ...cell, color: account.steamLinked ? '#4ade80' : '#64748b' }}>{account.steamLinked ? <>● Synced{account.steamIdLast4 ? <small style={{ display: 'block', color: '#94a3b8' }}>Steam ···{account.steamIdLast4}</small> : null}</> : 'Not synced'}</td>
          <td style={{ ...cell, color: account.approvedAt ? '#4ade80' : '#fbbf24' }}>{status(account)}</td>
          <td style={{ ...cell, color: '#94a3b8' }}>{new Date(account.createdAt).toLocaleString()}</td>
          <td style={cell}><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button disabled={approvalDisabled} onClick={() => void setApproval(account, !account.approvedAt)}>{busyId === account.id ? 'Saving…' : account.approvedAt ? 'Suspend' : 'Approve'}</button>
            <button disabled={protectedAccount || Boolean(busyId)} onClick={() => void resetPassword(account)}>Reset password</button>
            <button disabled={account.id === currentUserId || Boolean(busyId)} onClick={() => void remove(account)}>Delete</button>
          </div></td>
        </tr>;
      })}</tbody></table></div>}
    </div>
  </div>;
}
