'use client';
import './globals.css';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { isLoggedIn, clearAuth } from '../lib/auth';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: '◈', title: 'Overview of all your servers and recent activity' },
  { href: '/hosts', label: 'Hosts', icon: '⬡', title: 'Machines running the agent + game server processes on them' },
  { href: '/jobs', label: 'Jobs', icon: '⚡', title: 'Send one-off commands to your servers (restart, backup, etc.)' },
  { href: '/schedules', label: 'Schedules', icon: '◷', title: 'Run jobs automatically on a cron schedule' },
  { href: '/alerts', label: 'Alerts', icon: '◎', title: 'Get notified via Discord when servers go offline' },
  { href: '/settings', label: 'Settings', icon: '⚙', title: 'Organisation info and account settings' },
];

const PUBLIC = ['/', '/login'];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!PUBLIC.includes(pathname) && !isLoggedIn()) {
      router.replace('/login');
    } else {
      setReady(true);
    }
  }, [pathname, router]);

  const isPublic = PUBLIC.includes(pathname);

  function handleLogout() {
    clearAuth();
    router.push('/login');
  }

  return (
    <html lang="en">
      <head>
        <title>Mastermind — 7DTD Server Manager</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ margin: 0, display: 'flex', minHeight: '100vh', background: '#0a0a0f' }}>
        {!isPublic && ready && (
          <nav style={{
            width: 220,
            background: '#0d0d14',
            borderRight: '1px solid #1e1e2a',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            zIndex: 100,
          }}>
            {/* Logo */}
            <div style={{ padding: '1.5rem 1.25rem 1.25rem', borderBottom: '1px solid #1e1e2a' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                <div style={{
                  width: 32,
                  height: 32,
                  background: 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1rem',
                  boxShadow: '0 0 16px rgba(99,102,241,0.35)',
                }}>⬡</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#f1f5f9', lineHeight: 1.2 }}>Mastermind</div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', lineHeight: 1.2 }}>7DTD Manager</div>
                </div>
              </div>
            </div>

            {/* Nav items */}
            <div style={{ padding: '0.75rem 0.75rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {NAV.map((n) => {
                const active = pathname.startsWith(n.href);
                return (
                  <a
                    key={n.href}
                    href={n.href}
                    title={n.title}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.625rem',
                      padding: '0.5rem 0.75rem',
                      borderRadius: 6,
                      textDecoration: 'none',
                      fontSize: '0.875rem',
                      fontWeight: active ? 600 : 400,
                      color: active ? '#f1f5f9' : '#64748b',
                      background: active ? 'rgba(99,102,241,0.12)' : 'transparent',
                      borderLeft: active ? '2px solid #6366f1' : '2px solid transparent',
                      marginLeft: active ? 0 : 0,
                    }}
                  >
                    <span style={{ fontSize: '0.875rem', width: 18, textAlign: 'center', opacity: active ? 1 : 0.6 }}>{n.icon}</span>
                    {n.label}
                  </a>
                );
              })}
            </div>

            {/* Setup Guide */}
            <div style={{ padding: '0 0.75rem 0.5rem' }}>
              <a
                href="/hosts"
                onClick={() => localStorage.setItem('mm_tutorial_open', '1')}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.5rem 0.75rem', borderRadius: 6, textDecoration: 'none',
                  fontSize: '0.8rem', fontWeight: 600, color: '#818cf8',
                  background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)',
                  transition: 'background 0.15s',
                }}
              >
                <span style={{ fontSize: '0.75rem' }}>▶</span> Setup Guide
              </a>
            </div>

            {/* Logout */}
            <div style={{ padding: '0.75rem', borderTop: '1px solid #1e1e2a' }}>
              <button
                onClick={handleLogout}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  background: 'transparent',
                  border: '1px solid #252532',
                  borderRadius: 6,
                  color: '#64748b',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  justifyContent: 'center',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.color = '#f1f5f9';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#3f3f52';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.color = '#64748b';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#252532';
                }}
              >
                <span>↪</span> Sign out
              </button>
            </div>
          </nav>
        )}
        <main style={{
          flex: 1,
          marginLeft: isPublic ? 0 : 220,
          padding: isPublic ? 0 : '2rem 2.5rem',
          overflowY: 'auto',
          minHeight: '100vh',
          background: '#0a0a0f',
        }}>
          {(isPublic || ready) ? children : null}
        </main>
      </body>
    </html>
  );
}
