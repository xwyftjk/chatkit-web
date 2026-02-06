#!/usr/bin/env bun
/**
 * LongMemEval Test Server
 * A lightweight Bun server for running LongMemEval tests and streaming logs
 */

import { spawn, type Subprocess } from 'bun';
import { readdir, readFile, stat, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__dirname, 'reports');
const DATA_DIR = join(__dirname, 'data');
const RUNNER_DIR = join(__dirname, 'runner');

const PORT = parseInt(process.env.LONGMEMEVAL_PORT || '26600', 10);

// Auto-detect service URL (env > localhost > docker inspect > Docker network hostname)
async function detectServiceUrl(
  envVar: string | undefined,
  containerName: string,
  port: number,
  defaultHost?: string
): Promise<string> {
  // 1. Environment variable (use when running in Docker with explicit URLs)
  if (envVar) return envVar;

  // 2. Try localhost (works when services run on host)
  try {
    const resp = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(1000) });
    if (resp.ok) return `http://localhost:${port}`;
  } catch {}

  // 3. Try Docker container IP (when docker CLI is available, e.g. host)
  try {
    const proc = Bun.spawn(['docker', 'inspect', containerName, '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}']);
    const output = await new Response(proc.stdout).text();
    const ip = output.trim();
    if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
      return `http://${ip}:${port}`;
    }
  } catch {}

  // 4. Fallback: use container name so that when we run inside same Docker network it resolves
  const host = defaultHost ?? containerName;
  return `http://${host}:${port}`;
}

// Service URLs (will be initialized on startup)
let DIFFUSION_WORKER_URL = 'http://localhost:26407';
let INGEST_WORKER_URL = 'http://localhost:26406';
let LLM_ADAPTER_URL = 'http://localhost:26404';
let CONTEXT_ASSEMBLER_URL = 'http://localhost:26401';
let CONVERSATION_STORE_URL = 'http://localhost:26200';
let TEMPORAL_STORE_URL = 'http://localhost:26405';

// Fetch queue status from diffusion worker and ingest worker
async function getQueueStatus(): Promise<{ 
  pending: number; 
  ackPending: number; 
  total: number;
  ingestPending: number;
} | null> {
  try {
    // Fetch both in parallel
    const [diffusionRes, ingestRes] = await Promise.all([
      fetch(`${DIFFUSION_WORKER_URL}/health`, { signal: AbortSignal.timeout(3000) }).catch(() => null),
      fetch(`${INGEST_WORKER_URL}/health`, { signal: AbortSignal.timeout(3000) }).catch(() => null),
    ]);
    
    let pending = 0, ackPending = 0;
    if (diffusionRes?.ok) {
      const data = await diffusionRes.json() as { queue?: { pending?: number; ackPending?: number } };
      pending = data.queue?.pending ?? 0;
      ackPending = data.queue?.ackPending ?? 0;
    }
    
    let ingestPending = 0;
    if (ingestRes?.ok) {
      const data = await ingestRes.json() as { pendingSessions?: number };
      ingestPending = data.pendingSessions ?? 0;
    }
    
    return { pending, ackPending, total: pending + ackPending, ingestPending };
  } catch {
    return null;
  }
}

// Active test runs
interface TestRun {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  process: Subprocess | null;
  logs: string[];
  startTime: Date;
  endTime?: Date;
  config: RunConfig;
  exitCode?: number;
}

interface RunConfig {
  limit?: number;
  maxSessions?: number;
  configType?: string;
  enableQA?: boolean;
  enableDelay?: boolean;
  concurrency?: number;
  kValues?: string;
}

const activeRuns = new Map<string, TestRun>();
const sseClients = new Map<string, Set<ReadableStreamDefaultController>>();

function generateRunId(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yy}${mm}${dd}-${hh}${min}${ss}`;
}

function broadcastLog(runId: string, log: string) {
  const run = activeRuns.get(runId);
  if (run) {
    run.logs.push(log);
    // Keep only last 1000 lines
    if (run.logs.length > 1000) {
      run.logs.shift();
    }
  }

  const clients = sseClients.get(runId);
  if (clients) {
    const message = `data: ${JSON.stringify({ type: 'log', data: log })}\n\n`;
    for (const controller of clients) {
      try {
        controller.enqueue(new TextEncoder().encode(message));
      } catch (e) {
        // Client disconnected
        clients.delete(controller);
      }
    }
  }
}

function broadcastStatus(runId: string, status: TestRun['status'], exitCode?: number) {
  const clients = sseClients.get(runId);
  if (clients) {
    const message = `data: ${JSON.stringify({ type: 'status', data: { status, exitCode } })}\n\n`;
    for (const controller of clients) {
      try {
        controller.enqueue(new TextEncoder().encode(message));
      } catch (e) {
        clients.delete(controller);
      }
    }
  }
}

async function startTestRun(config: RunConfig): Promise<string> {
  // Check if there's already a running test
  for (const [id, run] of activeRuns) {
    if (run.status === 'running') {
      throw new Error(`Test ${id} is already running. Please wait or stop it first.`);
    }
  }
  
  const runId = generateRunId();
  
  // Build command arguments (runner must write to same REPORTS_DIR we read in listReports)
  console.log(`[startRun] output-dir for runner: ${REPORTS_DIR}`);
  const args: string[] = [
    'run', 'src/index.ts',
    '--dataset', join(DATA_DIR, 'longmemeval_s_cleaned.json'),
    '--output-dir', REPORTS_DIR,
    '--verbose',
  ];

  if (config.limit) args.push('--limit', String(config.limit));
  if (config.maxSessions) args.push('--max-sessions', String(config.maxSessions));
  if (config.configType) args.push('--config-type', config.configType);
  if (config.concurrency) args.push('--concurrency', String(config.concurrency));
  if (config.kValues) args.push('--k-values', config.kValues);
  if (config.enableQA) args.push('--qa');
  if (config.enableDelay === false) args.push('--no-delay');

  // Pass detected service URLs
  args.push('--conversation-store', CONVERSATION_STORE_URL);
  args.push('--context-assembler', CONTEXT_ASSEMBLER_URL);
  args.push('--temporal-store', TEMPORAL_STORE_URL);
  args.push('--llm-adapter', LLM_ADAPTER_URL);

  args.push('--run-id', runId);

  const run: TestRun = {
    id: runId,
    status: 'running',
    process: null,
    logs: [],
    startTime: new Date(),
    config,
  };

  activeRuns.set(runId, run);
  sseClients.set(runId, new Set());

  // Start the process
  const proc = spawn(['bun', ...args], {
    cwd: RUNNER_DIR,
    env: {
      ...process.env,
      FORCE_COLOR: '0',  // Disable colors for cleaner log output
      MEMORY_DIFFUSION_WORKER_URL: DIFFUSION_WORKER_URL,
      MEMORY_INGEST_WORKER_URL: INGEST_WORKER_URL,
      LLM_ADAPTER_URL: LLM_ADAPTER_URL,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  run.process = proc;

  // Stream stdout
  (async () => {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.trim()) {
          broadcastLog(runId, line);
        }
      }
    }
    
    if (buffer.trim()) {
      broadcastLog(runId, buffer);
    }
  })();

  // Stream stderr
  (async () => {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.trim()) {
          broadcastLog(runId, `[stderr] ${line}`);
        }
      }
    }
    
    if (buffer.trim()) {
      broadcastLog(runId, `[stderr] ${buffer}`);
    }
  })();

  // Wait for completion: then attach terminal logs to the report JSON (runner writes to REPORTS_DIR)
  proc.exited.then(async (exitCode) => {
    run.status = exitCode === 0 ? 'completed' : 'failed';
    run.exitCode = exitCode;
    run.endTime = new Date();
    run.process = null;
    broadcastStatus(runId, run.status, exitCode);

    // After a short delay (let runner flush the report file), find newest report and embed run logs
    if (run.logs.length > 0) {
      setTimeout(async () => {
        try {
          const newestFilename = await findNewestReportFile(REPORTS_DIR);
          if (newestFilename) {
            const jsonPath = join(REPORTS_DIR, newestFilename);
            const data = JSON.parse(await readFile(jsonPath, 'utf-8'));
            data.metadata = data.metadata || {};
            data.metadata.run_log = run.logs.join('\n');
            await writeFile(jsonPath, JSON.stringify(data, null, 2));
          }
        } catch (e) {
          console.error('Failed to attach run log to report:', e);
        }
      }, 800);
    }
  });

  return runId;
}

/** Find the most recently modified report JSON file in the directory (by mtime). */
async function findNewestReportFile(dir: string): Promise<string | null> {
  try {
    const files = await readdir(dir);
    let newest: string | null = null;
    let newestMtime = 0;
    for (const file of files) {
      if (!file.endsWith('.json') || !file.match(/^.+-report-.+\.json$/)) continue;
      const filePath = join(dir, file);
      const st = await stat(filePath);
      if (st.mtimeMs > newestMtime) {
        newestMtime = st.mtimeMs;
        newest = file;
      }
    }
    return newest;
  } catch {
    return null;
  }
}

function stopTestRun(runId: string): boolean {
  const run = activeRuns.get(runId);
  if (!run || !run.process) {
    return false;
  }

  // Use SIGKILL to forcefully terminate the process
  try {
    run.process.kill('SIGKILL');
  } catch (e) {
    // Process may have already exited
    console.log(`Process ${runId} already exited or kill failed:`, e);
  }
  
  run.status = 'stopped';
  run.endTime = new Date();
  run.process = null;
  broadcastLog(runId, '[system] Test stopped by user');
  broadcastStatus(runId, 'stopped');
  return true;
}

async function listReports(): Promise<Array<{
  id: string;
  filename: string;
  configType: string;
  timestamp: string;
  size: number;
}>> {
  try {
    const files = await readdir(REPORTS_DIR);
    const reports: Array<{
      id: string;
      filename: string;
      configType: string;
      timestamp: string;
      size: number;
      mtimeMs: number;
    }> = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      const filePath = join(REPORTS_DIR, file);
      const fileStat = await stat(filePath);
      
      // Parse filename: {configType}-report-{timestamp}.json
      const match = file.match(/^(.+)-report-(.+)\.json$/);
      if (match) {
        reports.push({
          id: file.replace('.json', ''),
          filename: file,
          configType: match[1],
          timestamp: match[2].replace(/T/g, ' ').replace(/-/g, ':'),
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
        });
      }
    }

    // Sort by file mtime descending (newest written first), so "just ran" always appears at top
    reports.sort((a, b) => b.mtimeMs - a.mtimeMs);
    console.log(`[listReports] ${reports.length} reports from ${REPORTS_DIR}`);
    return reports;
  } catch (e) {
    console.error('[listReports] error:', e);
    return [];
  }
}

async function getReport(id: string): Promise<{ json: any; markdown?: string } | null> {
  try {
    const jsonPath = join(REPORTS_DIR, `${id}.json`);
    const mdPath = join(REPORTS_DIR, `${id}.md`);
    
    const jsonContent = await readFile(jsonPath, 'utf-8');
    const json = JSON.parse(jsonContent);
    
    let markdown: string | undefined;
    try {
      markdown = await readFile(mdPath, 'utf-8');
    } catch {
      // Markdown file may not exist
    }
    
    return { json, markdown };
  } catch (e) {
    return null;
  }
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Prevent caching of report list/detail so "刷新" always gets latest (avoids stale empty list after a run)
const noCacheHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
};
function jsonNoCache(data: unknown) {
  return Response.json(data, { headers: { ...corsHeaders, ...noCacheHeaders } });
}

Bun.serve({
  port: PORT,
  idleTimeout: 255, // Max allowed (255 seconds) for long-running SSE connections
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (path === '/health') {
      return Response.json({ status: 'ok', activeRuns: activeRuns.size }, { headers: corsHeaders });
    }

    // Get current running test (for page refresh recovery)
    if (path === '/current-run') {
      for (const [id, run] of activeRuns) {
        if (run.status === 'running') {
          return Response.json({
            runId: id,
            status: run.status,
            startTime: run.startTime.toISOString(),
            config: run.config,
            logCount: run.logs.length,
          }, { headers: corsHeaders });
        }
      }
      return Response.json({ runId: null }, { headers: corsHeaders });
    }

    // Queue status (proxy to diffusion worker)
    if (path === '/queue-status') {
      const queueStatus = await getQueueStatus();
      
      // Get current run info
      let runInfo: { runId: string; startTime: string; elapsedMs: number } | null = null;
      for (const [id, run] of activeRuns) {
        if (run.status === 'running') {
          runInfo = {
            runId: id,
            startTime: run.startTime.toISOString(),
            elapsedMs: Date.now() - run.startTime.getTime(),
          };
          break;
        }
      }
      
      return Response.json({
        queue: queueStatus,
        run: runInfo,
        diffusionWorkerUrl: DIFFUSION_WORKER_URL,
      }, { headers: corsHeaders });
    }

    // Start a test run
    if (path === '/run' && req.method === 'POST') {
      try {
        const config = await req.json() as RunConfig;
        const runId = await startTestRun(config);
        return Response.json({ runId }, { headers: corsHeaders });
      } catch (e) {
        return Response.json(
          { error: e instanceof Error ? e.message : 'Failed to start test' },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Stop a test run
    if (path.startsWith('/run/') && path.endsWith('/stop') && req.method === 'POST') {
      const runId = path.replace('/run/', '').replace('/stop', '');
      const success = stopTestRun(runId);
      return Response.json({ success }, { headers: corsHeaders });
    }

    // Get run status
    if (path.startsWith('/run/') && !path.includes('/logs')) {
      const runId = path.replace('/run/', '');
      const run = activeRuns.get(runId);
      if (!run) {
        return Response.json({ error: 'Run not found' }, { status: 404, headers: corsHeaders });
      }
      return Response.json({
        id: run.id,
        status: run.status,
        startTime: run.startTime.toISOString(),
        endTime: run.endTime?.toISOString(),
        exitCode: run.exitCode,
        config: run.config,
        logCount: run.logs.length,
      }, { headers: corsHeaders });
    }

    // SSE logs stream
    if (path.startsWith('/run/') && path.endsWith('/logs')) {
      const runId = path.replace('/run/', '').replace('/logs', '');
      const run = activeRuns.get(runId);
      
      if (!run) {
        return Response.json({ error: 'Run not found' }, { status: 404, headers: corsHeaders });
      }

      // Check if client wants history (default: no, to avoid duplicates on reconnect)
      const url = new URL(req.url);
      const withHistory = url.searchParams.get('history') === 'true';

      let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
      
      const stream = new ReadableStream({
        start(controller) {
          // Only send existing logs if explicitly requested
          if (withHistory) {
            for (const log of run.logs) {
              const message = `data: ${JSON.stringify({ type: 'log', data: log })}\n\n`;
              controller.enqueue(new TextEncoder().encode(message));
            }
          }

          // Send current status
          const statusMessage = `data: ${JSON.stringify({ type: 'status', data: { status: run.status, exitCode: run.exitCode } })}\n\n`;
          controller.enqueue(new TextEncoder().encode(statusMessage));

          // Register for future updates
          if (!sseClients.has(runId)) {
            sseClients.set(runId, new Set());
          }
          sseClients.get(runId)!.add(controller);
          
          // Send heartbeat every 15 seconds to keep connection alive
          heartbeatInterval = setInterval(() => {
            try {
              controller.enqueue(new TextEncoder().encode(`: heartbeat\n\n`));
            } catch {
              // Connection closed
              if (heartbeatInterval) clearInterval(heartbeatInterval);
            }
          }, 15000);
        },
        cancel(controller) {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          sseClients.get(runId)?.delete(controller);
        },
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // List reports (no-store so browser/proxy never cache; 刷新 always gets latest)
    if (path === '/reports' && req.method === 'GET') {
      const reports = await listReports();
      const url = new URL(req.url);
      const debug = url.searchParams.get('debug') === '1';
      const body = debug
        ? { reports, _debug: { reportsDir: REPORTS_DIR, count: reports.length } }
        : { reports };
      return jsonNoCache(body);
    }

    // Get single report
    if (path.startsWith('/reports/') && req.method === 'GET') {
      const id = path.replace('/reports/', '');
      const report = await getReport(id);
      if (!report) {
        return Response.json({ error: 'Report not found' }, { status: 404, headers: corsHeaders });
      }
      return jsonNoCache(report);
    }

    // 404
    return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
  },
});

// Initialize and start
(async () => {
  // Detect all service URLs
  DIFFUSION_WORKER_URL = await detectServiceUrl(
    process.env.MEMORY_DIFFUSION_WORKER_URL,
    'chatkit-memory-diffusion-worker',
    26407
  );
  INGEST_WORKER_URL = await detectServiceUrl(
    process.env.MEMORY_INGEST_WORKER_URL,
    'chatkit-memory-ingest-worker',
    26406
  );
  LLM_ADAPTER_URL = await detectServiceUrl(
    process.env.LLM_ADAPTER_URL,
    'chatkit-llm-adapter',
    26404
  );
  CONTEXT_ASSEMBLER_URL = await detectServiceUrl(
    process.env.CONTEXT_ASSEMBLER_URL,
    'chatkit-context-assembler',
    26401
  );
  CONVERSATION_STORE_URL = await detectServiceUrl(
    process.env.CONVERSATION_STORE_URL,
    'chatkit-conversation-store',
    26200
  );
  TEMPORAL_STORE_URL = await detectServiceUrl(
    process.env.TEMPORAL_STORE_URL,
    'chatkit-memory-store',
    26405
  );
  
  console.log(`🧪 LongMemEval Server running at http://localhost:${PORT}`);
  console.log(`   Reports directory: ${REPORTS_DIR}`);
  console.log(`   Data directory: ${DATA_DIR}`);
  console.log(`   Services:`);
  console.log(`     - Conversation store: ${CONVERSATION_STORE_URL}`);
  console.log(`     - Context assembler: ${CONTEXT_ASSEMBLER_URL}`);
  console.log(`     - LLM adapter: ${LLM_ADAPTER_URL}`);
  console.log(`     - Diffusion worker: ${DIFFUSION_WORKER_URL}`);
  console.log(`     - Ingest worker: ${INGEST_WORKER_URL}`);
  console.log(`     - Temporal store: ${TEMPORAL_STORE_URL}`);
})();
