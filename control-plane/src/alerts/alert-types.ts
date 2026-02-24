/** MVP alert types */
export const ALERT_TYPES = ['SERVER_DOWN', 'SERVER_RESTART', 'AGENT_OFFLINE'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/** Context passed when sending an alert (used for structured formatting) */
export interface AlertContext {
  orgId: string;
  orgName?: string;
  /** For SERVER_DOWN / SERVER_RESTART */
  serverInstanceId?: string;
  serverInstanceName?: string;
  hostId?: string;
  hostName?: string;
  /** For AGENT_OFFLINE */
  /** Optional extra (e.g. lastHeartbeatAt, error message) */
  [key: string]: unknown;
}
