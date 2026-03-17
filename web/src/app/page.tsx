'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isLoggedIn } from '../lib/auth';

const CONTROL_PLANE_URL = process.env.NEXT_PUBLIC_CONTROL_PLANE_URL || 'http://localhost:3001';

const SETUP_STEPS = [
  { step: '1', title: 'Start infrastructure', cmd: 'make up', desc: 'Starts PostgreSQL and Redis via Docker' },
  { step: '2', title: 'Initialize database', cmd: 'make migrate', desc: 'Runs schema migration and seeds default data' },
  { step: '3', title: 'Start services', cmd: 'pnpm dev  (in control-plane/ and web/)', desc: 'Runs the API and this web UI' },
];

export default function Home() {
  const router = useRouter();
  const [health, setHealth] = useState<{ status?: string; error?: string } | null>(null);

  useEffect(() => {
    if (isLoggedIn()) {
      router.replace('/dashboard');
      return;
    }
    fetch(`${CONTROL_PLANE_URL}/health`)
      .then((res) => res.json())
      .then((data) => setHealth(data))
      .catch(() => setHealth({ error: 'unreachable' }));
  }, [router]);

  const isHealthy = health?.status === 'ok';
  const isUnhealthy = !!health?.error;

  return (
    <div style={{
      display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse at 30% 20%, rgba(99,102,241,0.08) 0%, #0a0a0f 60%)',
      flexDirection: 'column', gap: '1.5rem', padding: '2rem',
    }}>
      <div style={{
        background: '#111118', border: '1px solid #1e1e2a', borderRadius: 16,
        padding: '2.5rem 3rem', maxWidth: 520, width: '100%', textAlign: 'center',
      }}>
        <div style={{
          width: 56, height: 56, background: 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)',
          borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.5rem', margin: '0 auto 1.25rem', boxShadow: '0 0 32px rgba(99,102,241,0.4)',
        }}>⬡</div>
        <h1 style={{ margin: '0 0 0.375rem', fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9' }}>
          Mastermind
        </h1>
        <p style={{ margin: '0 0 2rem', fontSize: '0.875rem', color: '#64748b' }}>
          7 Days to Die — AI Server Manager
        </p>

        {/* Health indicator */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          padding: '0.875rem 1rem', borderRadius: 8,
          background: health === null ? 'rgba(100,116,139,0.06)' :
            isHealthy ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
          border: `1px solid ${health === null ? '#1e1e2a' : isHealthy ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: health === null ? '#64748b' : isHealthy ? '#4ade80' : '#f87171',
            boxShadow: isHealthy ? '0 0 8px #4ade80' : undefined,
          }} />
          <span style={{ fontSize: '0.875rem', color: health === null ? '#64748b' : isHealthy ? '#4ade80' : '#f87171' }}>
            {health === null && 'Checking control plane…'}
            {isHealthy && 'Control plane is running'}
            {isUnhealthy && 'Control plane not reachable'}
          </span>
        </div>

        {/* Setup guide shown when CP is unreachable */}
        {isUnhealthy && (
          <div style={{ marginTop: '1.5rem', textAlign: 'left' }}>
            <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: '#94a3b8' }}>
              Run these commands from the project root to get started:
            </p>
            {SETUP_STEPS.map((s) => (
              <div key={s.step} style={{
                display: 'flex', gap: '0.875rem', alignItems: 'flex-start',
                padding: '0.75rem', background: '#0d0d14', borderRadius: 8,
                border: '1px solid #1e1e2a', marginBottom: '0.5rem',
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', background: 'rgba(99,102,241,0.15)',
                  border: '1px solid rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, color: '#818cf8', flexShrink: 0,
                }}>{s.step}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#e2e8f0' }}>{s.title}</div>
                  <code style={{ display: 'block', fontSize: '0.78rem', color: '#818cf8', marginTop: '0.2rem', wordBreak: 'break-all' }}>{s.cmd}</code>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem' }}>{s.desc}</div>
                </div>
              </div>
            ))}
            <p style={{ margin: '0.75rem 0 0', fontSize: '0.75rem', color: '#3f3f52', textAlign: 'center' }}>
              First time? Run <code style={{ color: '#64748b' }}>make bootstrap</code> first to install dependencies.
            </p>
          </div>
        )}

        {/* CTA */}
        {(isHealthy || health === null) && (
          <a href="/login" style={{
            display: 'inline-block', marginTop: '1.5rem',
            padding: '0.65rem 2rem',
            background: isHealthy
              ? 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)'
              : 'rgba(99,102,241,0.15)',
            color: '#fff', textDecoration: 'none', borderRadius: 8,
            fontSize: '0.875rem', fontWeight: 600,
            boxShadow: isHealthy ? '0 4px 16px rgba(99,102,241,0.3)' : 'none',
            border: isHealthy ? 'none' : '1px solid rgba(99,102,241,0.3)',
          }}>
            {health === null ? 'Open Dashboard' : 'Sign In →'}
          </a>
        )}
      </div>
    </div>
  );
}
