/**
 * LongMemEval Test API Client
 */

function getBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const port = window.location.port;
    // In production (Docker), use /longmemeval prefix (nginx proxies to local Bun server)
    // Production ports: 80, 443, empty, or any custom Docker exposed port (e.g., 5245)
    // Development port: 5173 (Vite dev server)
    const isDevelopment = port === '5173';
    if (!isDevelopment) {
      return `${window.location.origin}/longmemeval`;
    }
    // Development: direct access to Bun server
    return `${window.location.protocol}//${window.location.hostname}:26600`;
  }
  return 'http://localhost:26600';
}

export interface RunConfig {
  limit?: number;
  maxSessions?: number;
  configType?: string;
  enableQA?: boolean;
  enableDelay?: boolean;
  concurrency?: number;
  kValues?: string;
}

export interface RunStatus {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  startTime: string;
  endTime?: string;
  exitCode?: number;
  config: RunConfig;
  logCount: number;
}

export interface Report {
  id: string;
  filename: string;
  configType: string;
  timestamp: string;
  size: number;
}

export interface ReportDetail {
  json: {
    suite_name: string;
    total_cases: number;
    passed: number;
    failed: number;
    longmemeval_metrics?: {
      retrieval?: {
        recall_at_k: Record<string, number>;
        total_questions: number;
      };
      qa?: {
        accuracy: number;
        exact_match: number;
        total_questions: number;
      };
    };
    metadata?: {
      generated_at: string;
      git_tag: string;
      config_type: string;
    };
  };
  markdown?: string;
}

/**
 * Check server health
 */
export async function checkHealth(): Promise<{ status: string; activeRuns: number }> {
  const response = await fetch(`${getBaseUrl()}/health`);
  if (!response.ok) {
    throw new Error('Server not available');
  }
  return response.json();
}

/**
 * Start a new test run
 */
export async function startRun(config: RunConfig): Promise<{ runId: string }> {
  const response = await fetch(`${getBaseUrl()}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to start test');
  }

  return response.json();
}

/**
 * Stop a test run
 */
export async function stopRun(runId: string): Promise<{ success: boolean }> {
  const response = await fetch(`${getBaseUrl()}/run/${runId}/stop`, {
    method: 'POST',
  });
  return response.json();
}

/**
 * Get run status
 */
export async function getRunStatus(runId: string): Promise<RunStatus> {
  const response = await fetch(`${getBaseUrl()}/run/${runId}`);
  if (!response.ok) {
    throw new Error('Run not found');
  }
  return response.json();
}

/**
 * Subscribe to run logs via SSE
 */
export function subscribeToLogs(
  runId: string,
  onLog: (log: string) => void,
  onStatus: (status: { status: string; exitCode?: number }) => void,
  withHistory: boolean = true
): () => void {
  const url = withHistory 
    ? `${getBaseUrl()}/run/${runId}/logs?history=true`
    : `${getBaseUrl()}/run/${runId}/logs`;
  const eventSource = new EventSource(url);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'log') {
        onLog(data.data);
      } else if (data.type === 'status') {
        onStatus(data.data);
      }
    } catch (e) {
      console.error('Failed to parse SSE message:', e);
    }
  };

  eventSource.onerror = () => {
    // EventSource will auto-reconnect, only log if connection is closed
    if (eventSource.readyState === EventSource.CLOSED) {
      console.warn('SSE connection closed');
    }
    // Don't log transient errors as EventSource auto-reconnects
  };

  return () => {
    eventSource.close();
  };
}

/**
 * List all reports
 */
export async function listReports(): Promise<{ reports: Report[] }> {
  const response = await fetch(`${getBaseUrl()}/reports`);
  if (!response.ok) {
    throw new Error('Failed to list reports');
  }
  return response.json();
}

/**
 * Get a specific report
 */
export async function getReport(id: string): Promise<ReportDetail> {
  const response = await fetch(`${getBaseUrl()}/reports/${id}`);
  if (!response.ok) {
    throw new Error('Report not found');
  }
  return response.json();
}

/**
 * Current run info
 */
export interface CurrentRun {
  runId: string | null;
  status?: string;
  startTime?: string;
  config?: RunConfig;
  logCount?: number;
}

/**
 * Get current running test (for page refresh recovery)
 */
export async function getCurrentRun(): Promise<CurrentRun> {
  const response = await fetch(`${getBaseUrl()}/current-run`);
  if (!response.ok) {
    throw new Error('Failed to get current run');
  }
  return response.json();
}

/**
 * Queue status response
 */
export interface QueueStatus {
  queue: { pending: number; ackPending: number; total: number; ingestPending: number } | null;
  run: { runId: string; startTime: string; elapsedMs: number } | null;
  diffusionWorkerUrl: string;
}

/**
 * Get queue status and current run info
 */
export async function getQueueStatus(): Promise<QueueStatus> {
  const response = await fetch(`${getBaseUrl()}/queue-status`);
  if (!response.ok) {
    throw new Error('Failed to get queue status');
  }
  return response.json();
}
