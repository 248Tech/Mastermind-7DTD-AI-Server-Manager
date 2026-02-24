'use client';

import { useEffect, useState } from 'react';

const CONTROL_PLANE_URL = process.env.NEXT_PUBLIC_CONTROL_PLANE_URL || 'http://localhost:3001';

export default function Home() {
  const [health, setHealth] = useState<{ status?: string; error?: string } | null>(null);

  useEffect(() => {
    fetch(`${CONTROL_PLANE_URL}/health`)
      .then((res) => res.json())
      .then((data) => setHealth(data))
      .catch((err) => setHealth({ error: err.message }));
  }, []);

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Mastermind — 7DTD Server Manager</h1>
      <p>Control Plane + Host Agent for game server management.</p>
      <section style={{ marginTop: '1.5rem' }}>
        <h2>Backend status</h2>
        {health === null && <p>Checking…</p>}
        {health?.status === 'ok' && (
          <p style={{ color: 'green' }}>Connected — control plane is healthy.</p>
        )}
        {health?.error && (
          <p style={{ color: 'red' }}>Not connected: {health.error}. Is the control plane running on {CONTROL_PLANE_URL}?</p>
        )}
      </section>
    </main>
  );
}
