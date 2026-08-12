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
export interface Org { id: string; name: string; slug: string; discordWebhookUrl?: string; frigateUrl?: string; frigateApiKey?: string; frigateWebhookSecret?: string; avoidBloodMoonRestart?: boolean; }
export interface Host { id: string; orgId: string; name: string; status: string | null; lastHeartbeatAt: string | null; lastMetrics: Record<string,unknown> | null; agentVersion: string | null; createdAt: string; serverInstances: { id: string; name: string }[]; }
export interface ServerInstance { id: string; orgId: string; hostId: string; name: string; gameType: string; capabilities: string[]; installPath: string | null; startCommand: string | null; telnetHost: string | null; telnetPort: number | null; createdAt: string; }
export interface Job { id: string; orgId: string; serverInstanceId: string | null; serverName?: string; type: string; payload: unknown; createdAt: string; startedBy?: { id:string; name:string; email:string } | null; latestRun: { id: string; status: string; startedAt: string | null; finishedAt: string | null; result: unknown } | null; }
export interface Schedule { id: string; orgId: string; serverInstanceId: string; name: string; cronExpression: string; jobType: string; payload?: Record<string,unknown>; enabled: boolean; nextRunAt: string | null; lastRunAt: string | null; lastRunStatus: string | null; }
export interface AlertRule { id: string; orgId: string; name: string; condition: unknown; channel: unknown; enabled: boolean; createdAt: string; }
export interface PairingToken { id: string; token: string; expiresAt: string; expiresInSec: number; }
export interface ServerLog { id: string; serverInstanceId: string; content: string; createdAt: string; }
export interface LogKeywordRule { id: string; name: string; enabled: boolean; condition: { keyword: string; caseSensitive: boolean; serverInstanceId: string }; createdAt: string; }
export interface LogKeywordMatch { id: string; sourceId: string; createdAt: string; payload: { ruleId: string; ruleName: string; keyword: string; excerpt: string }; }
export interface HealthSample { id: string; hostId: string; cpuPercent: number; ramUsedMb: number; ramTotalMb: number; diskUsedGb: number; latencyMs: number; gameReachable: boolean; createdAt: string; }
export interface HealthHost { id: string; name: string; status: string; lastHeartbeatAt: string|null; lastMetrics: { cpu?:number; ramUsedMb?:number; ramTotalMb?:number; diskUsedGb?:number; latencyMs?:number; gameReachable?:boolean }|null; }
export interface HealthDashboard { hosts: HealthHost[]; samples: HealthSample[]; intervalSec: number; }
export interface ChatMessage { id:string; sourceId:string; createdAt:string; payload:{playerId:string;entityId:string;playerName:string;channel:string;message:string;serverInstanceName:string}; }
export interface PlayerRecord { id:string; serverInstanceId:string; identityKey:string; steamId:string|null; eosId:string|null; entityId:number|null; name:string; online:boolean; currentSessionStartedAt:string|null; sessionSeconds:number; lifetimeSeconds:number; firstSeenAt:string; lastSeenAt:string; }
export interface ServerAdminRecord { platform?:string; userId:string; name?:string; permissionLevel:number; }
export interface ModRecord { folder:string; name:string; author?:string; website?:string; version?:string; activatedAt:string; configFiles?:string[]; }
export interface SaveRecord { id:string; createdAt:string; gameDay:number; kind:'full-world'|'region-healer'; sizeBytes:number; }
