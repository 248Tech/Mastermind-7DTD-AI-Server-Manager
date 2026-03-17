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

  const inputStyle: React.CSSProperties = {
    padding: '0.6rem 0.875rem',
    borderRadius: 8,
    border: '1px solid #252532',
    fontSize: '0.9rem',
    background: '#111118',
    color: '#f1f5f9',
    width: '100%',
    outline: 'none',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  };

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
      const msg = err instanceof Error ? err.message : 'Login failed';
      if (msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network') || msg === 'Failed to fetch' || msg.toLowerCase().includes('unreachable')) {
        setError('Cannot reach the control plane. Make sure it is running on ' + (process.env.NEXT_PUBLIC_CONTROL_PLANE_URL || 'http://localhost:3001') + ' (run: cd control-plane && pnpm dev)');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(ellipse at 30% 20%, rgba(99,102,241,0.08) 0%, #0a0a0f 60%)',
      padding: '1rem',
    }}>
      {/* Subtle grid bg */}
      <div style={{
        position: 'fixed',
        inset: 0,
        backgroundImage: 'linear-gradient(rgba(99,102,241,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.04) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
        pointerEvents: 'none',
      }} />

      <div style={{
        position: 'relative',
        background: 'rgba(13,13,20,0.95)',
        border: '1px solid #1e1e2a',
        borderRadius: 16,
        padding: '2.5rem',
        width: '100%',
        maxWidth: 400,
        boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.06)',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
          <div style={{
            width: 40,
            height: 40,
            background: 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)',
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.25rem',
            boxShadow: '0 0 24px rgba(99,102,241,0.4)',
          }}>⬡</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#f1f5f9' }}>Mastermind</div>
            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>7DTD Server Manager</div>
          </div>
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', background: '#111118', borderRadius: 8, padding: 3, marginBottom: '1.75rem', border: '1px solid #1e1e2a' }}>
          {(['login', 'register'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                padding: '0.45rem',
                borderRadius: 6,
                border: 'none',
                background: mode === m ? '#6366f1' : 'transparent',
                color: mode === m ? '#fff' : '#64748b',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: mode === m ? 600 : 400,
                transition: 'all 0.15s ease',
              }}
            >
              {m === 'login' ? 'Sign in' : 'Register'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {mode === 'register' && (
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.375rem', fontWeight: 500 }}>
                Name <span style={{ color: '#64748b' }}>(optional)</span>
              </label>
              <input
                placeholder="Your name"
                value={name}
                onChange={e => setName(e.target.value)}
                style={inputStyle}
                onFocus={e => {
                  e.target.style.borderColor = '#6366f1';
                  e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)';
                }}
                onBlur={e => {
                  e.target.style.borderColor = '#252532';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>
          )}
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.375rem', fontWeight: 500 }}>
              Email
            </label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              style={inputStyle}
              onFocus={e => {
                e.target.style.borderColor = '#6366f1';
                e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)';
              }}
              onBlur={e => {
                e.target.style.borderColor = '#252532';
                e.target.style.boxShadow = 'none';
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.375rem', fontWeight: 500 }}>
              Password
            </label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={inputStyle}
              onFocus={e => {
                e.target.style.borderColor = '#6366f1';
                e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.12)';
              }}
              onBlur={e => {
                e.target.style.borderColor = '#252532';
                e.target.style.boxShadow = 'none';
              }}
            />
          </div>

          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 6,
              padding: '0.5rem 0.75rem',
              color: '#f87171',
              fontSize: '0.85rem',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '0.65rem',
              background: loading ? '#3f3f52' : 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '0.9rem',
              fontWeight: 600,
              marginTop: '0.25rem',
              boxShadow: loading ? 'none' : '0 4px 16px rgba(99,102,241,0.3)',
            }}
          >
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', borderTop: '1px solid #1e1e2a', paddingTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#3f3f52' }}>
            Default: <code style={{ color: '#64748b', fontFamily: 'monospace' }}>admin@mastermind.local</code>
          </p>
          <button
            type="button"
            onClick={() => { setEmail('admin@mastermind.local'); setPassword('changeme'); setMode('login'); }}
            style={{
              flexShrink: 0, padding: '0.3rem 0.625rem', background: 'transparent',
              border: '1px solid #252532', borderRadius: 5, color: '#64748b',
              fontSize: '0.72rem', cursor: 'pointer',
            }}
          >
            Fill in
          </button>
        </div>
      </div>
    </div>
  );
}
