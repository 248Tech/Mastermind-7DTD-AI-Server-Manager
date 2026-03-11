'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, AuthResponse } from '../../../lib/api';
import { saveAuth } from '../../../lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post<AuthResponse>(
        mode === 'login' ? '/api/auth/login' : '/api/auth/register',
        { email, password, ...(mode === 'register' ? { name } : {}) },
      );
      saveAuth(res.access_token, res.userId, res.orgId);
      router.push('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '2.5rem', width: 380, boxShadow: '0 2px 16px rgba(0,0,0,0.1)' }}>
        <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.5rem' }}>Mastermind</h1>
        <p style={{ margin: '0 0 2rem', color: '#666', fontSize: '0.9rem' }}>7DTD Server Manager</p>
        <div style={{ display: 'flex', marginBottom: '1.5rem', gap: 8 }}>
          {(['login', 'register'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{ flex: 1, padding: '0.5rem', borderRadius: 6, border: '1px solid #ddd', background: mode === m ? '#1a1a2e' : '#fff', color: mode === m ? '#fff' : '#333', cursor: 'pointer', fontWeight: mode === m ? 600 : 400 }}>
              {m === 'login' ? 'Login' : 'Register'}
            </button>
          ))}
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {mode === 'register' && (
            <input placeholder="Name (optional)" value={name} onChange={e => setName(e.target.value)} style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid #ddd', fontSize: '0.9rem' }} />
          )}
          <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid #ddd', fontSize: '0.9rem' }} />
          <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid #ddd', fontSize: '0.9rem' }} />
          {error && <p style={{ color: 'red', margin: 0, fontSize: '0.85rem' }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ padding: '0.7rem', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer', fontSize: '0.95rem', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Please wait\u2026' : mode === 'login' ? 'Login' : 'Create Account'}
          </button>
        </form>
        <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#888', textAlign: 'center' }}>
          Default credentials: admin@mastermind.local / changeme
        </p>
      </div>
    </div>
  );
}
