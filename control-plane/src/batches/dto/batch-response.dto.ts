/** Batch list/detail response: counts + status */
export interface BatchSummaryDto {
  id: string;
  orgId: string;
  type: string;
  status: string;
  totalCount: number;
  pendingCount: number;
  runningCount: number;
  successCount: number;
  failedCount: number;
  cancelledCount: number;
  createdById: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** Job in batch with latest run status (for batch detail / jobs list) */
export interface BatchJobDto {
  jobId: string;
  serverInstanceId: string;
  serverName?: string;
  runId: string;
  runStatus: string;
  runFinishedAt: string | null;
  errorMessage?: string;
}
