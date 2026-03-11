'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { isLoggedIn, clearAuth } from '../lib/auth';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/hosts', label: 'Hosts' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/schedules', label: 'Schedules' },
  { href: '/alerts', label: 'Alerts' },
  { href: '/settings', label: 'Settings' },
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
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', display: 'flex', minHeight: '100vh', background: '#f8f9fa' }}>
        {!isPublic && ready && (
          <nav style={{ width: 200, background: '#1a1a2e', color: '#fff', padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', flexShrink: 0 }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.5rem', color: '#e0e0ff' }}>Mastermind</div>
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                style={{
                  color: pathname.startsWith(n.href) ? '#fff' : '#aaa',
                  textDecoration: 'none',
                  padding: '0.4rem 0.75rem',
                  borderRadius: 6,
                  background: pathname.startsWith(n.href) ? 'rgba(255,255,255,0.15)' : 'transparent',
                  fontSize: '0.9rem',
                }}
              >{n.label}</a>
            ))}
            <div style={{ marginTop: 'auto' }}>
              <button
                onClick={handleLogout}
                style={{ background: 'none', border: '1px solid #555', color: '#aaa', padding: '0.4rem 0.75rem', borderRadius: 6, cursor: 'pointer', width: '100%', fontSize: '0.85rem' }}
              >Logout</button>
            </div>
          </nav>
        )}
        <main style={{ flex: 1, padding: isPublic ? 0 : '2rem', overflowY: 'auto' }}>
          {(isPublic || ready) ? children : null}
        </main>
      </body>
    </html>
  );
}
