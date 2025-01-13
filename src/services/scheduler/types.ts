export interface Job {
  id: string;
  schedule: string;
  handler: () => Promise<any>;
  metadata?: Record<string, any>;
}

export interface JobResult {
  jobId: string;
  status: "success" | "error";
  error?: string;
  timestamp: string;
  result?: any;
}

export interface SchedulerConfig {
  mode?: "serverless" | "single-node";
  timeZone?: string;
  heartbeatInterval?: number; // in milliseconds
  cacheTTL?: number; // in milliseconds
}
