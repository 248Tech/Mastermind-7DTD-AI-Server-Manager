const CP = (): string => {
  const url = process.env.NEXT_PUBLIC_CONTROL_PLANE_URL;
  if (!url) {
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
      console.warn('[mastermind] NEXT_PUBLIC_CONTROL_PLANE_URL is not set — falling back to http://localhost:3001');
    }
    return 'http://localhost:3001';
  }
  return url;
};

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('mm_token');
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${CP()}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// Auth types
export interface AuthResponse { access_token: string; userId: string; orgId: string; }
export interface User { id: string; email: string; name?: string; }
export interface Org { id: string; name: string; slug: string; }
export interface Host { id: string; orgId: string; name: string; status: string | null; lastHeartbeatAt: string | null; lastMetrics: Record<string,unknown> | null; agentVersion: string | null; createdAt: string; serverInstances: { id: string; name: string }[]; }
export interface ServerInstance { id: string; orgId: string; hostId: string; name: string; gameType: string; capabilities: string[]; installPath: string | null; startCommand: string | null; telnetHost: string | null; telnetPort: number | null; createdAt: string; }
export interface Job { id: string; orgId: string; serverInstanceId: string | null; serverName?: string; type: string; payload: unknown; createdAt: string; latestRun: { id: string; status: string; startedAt: string | null; finishedAt: string | null; result: unknown } | null; }
export interface Schedule { id: string; orgId: string; serverInstanceId: string; name: string; cronExpression: string; jobType: string; enabled: boolean; nextRunAt: string | null; lastRunAt: string | null; lastRunStatus: string | null; }
export interface AlertRule { id: string; orgId: string; name: string; condition: unknown; channel: unknown; enabled: boolean; createdAt: string; }
export interface PairingToken { id: string; token: string; expiresAt: string; expiresInSec: number; }
