import { useState, useEffect, useRef, useCallback } from 'react';
import {
  checkHealth,
  startRun,
  stopRun,
  subscribeToLogs,
  listReports,
  getReport,
  getQueueStatus,
  getCurrentRun,
  type RunConfig,
  type Report,
  type ReportDetail,
  type QueueStatus,
} from '../api/longmemeval.js';

export function LongMemEval() {
  // Server status
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  
  // Run configuration - fixed production-like settings
  const [config, setConfig] = useState<RunConfig>({
    limit: 1,
    maxSessions: 1,
    configType: 'production-like',
    enableQA: false,
    enableDelay: true,
    concurrency: 1,
    kValues: '1,3,5,10',
  });
  
  // Run state
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'completed' | 'failed' | 'stopped'>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  
  // Reports
  const [reports, setReports] = useState<Report[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);

  const [selectedReport, setSelectedReport] = useState<ReportDetail | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  
  // Queue status
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [runStartTime, setRunStartTime] = useState<number | null>(null);
  
  // Refs
  const logsEndRef = useRef<HTMLDivElement>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Check server health
  useEffect(() => {
    const checkServer = async () => {
      try {
        await checkHealth();
        setServerOnline(true);
      } catch {
        setServerOnline(false);
      }
    };
    
    checkServer();
    const interval = setInterval(checkServer, 10000);
    return () => clearInterval(interval);
  }, []);

  // Load reports
  const loadReports = useCallback(async () => {
    setReportsLoading(true);
    try {
      const result = await listReports();
      setReports(result.reports);
    } catch (e) {
      console.error('Failed to load reports:', e);
    } finally {
      setReportsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (serverOnline) {
      loadReports();
    }
  }, [serverOnline, loadReports]);

  // Recover running test on page load/refresh
  useEffect(() => {
    if (!serverOnline || runId) return; // Already have a run
    
    const recoverRun = async () => {
      try {
        const current = await getCurrentRun();
        if (current.runId) {
          console.log('Recovering running test:', current.runId);
          setRunId(current.runId);
          setRunStatus('running');
          
          // Subscribe to logs with history
          const seenLogs = new Set<string>();
          unsubscribeRef.current = subscribeToLogs(
            current.runId,
            (log) => {
              const cleanLog = log.trim();
              if (cleanLog && !seenLogs.has(cleanLog)) {
                seenLogs.add(cleanLog);
                setLogs((prev) => [...prev, cleanLog]);
              }
            },
            (status) => {
              setRunStatus(status.status as any);
              if (status.status !== 'running') {
                loadReports();
              }
            },
            true // with history
          );
        }
      } catch (e) {
        console.error('Failed to recover running test:', e);
      }
    };
    
    recoverRun();
  }, [serverOnline, runId, loadReports]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Poll queue status always (independent of test running)
  useEffect(() => {
    if (!serverOnline) {
      setQueueStatus(null);
      return;
    }
    
    const pollQueue = async () => {
      try {
        const status = await getQueueStatus();
        setQueueStatus(status);
      } catch {
        // Ignore errors during polling
      }
    };
    
    pollQueue();
    const interval = setInterval(pollQueue, 2000);
    return () => clearInterval(interval);
  }, [serverOnline]);
  
  // Clear run start time when not running
  useEffect(() => {
    if (runStatus !== 'running') {
      setRunStartTime(null);
    }
  }, [runStatus]);

  // Calculate elapsed time for display
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (!runStartTime || runStatus !== 'running') {
      setElapsedSeconds(0);
      return;
    }
    
    const updateElapsed = () => {
      setElapsedSeconds(Math.floor((Date.now() - runStartTime) / 1000));
    };
    
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [runStartTime, runStatus]);

  // Start test
  const handleStart = async () => {
    // Prevent multiple starts
    if (!serverOnline || isRunning || isStarting) return;
    
    // Close any existing SSE connection
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    
    setIsStarting(true);
    setLogs([]);
    setRunStatus('running');
    setRunStartTime(Date.now());
    
    try {
      const result = await startRun(config);
      setRunId(result.runId);
      
      // Subscribe to logs
      const seenLogs = new Set<string>();
      unsubscribeRef.current = subscribeToLogs(
        result.runId,
        (log) => {
          // Simple dedup based on log content
          const cleanLog = log.trim();
          if (cleanLog && !seenLogs.has(cleanLog)) {
            seenLogs.add(cleanLog);
            setLogs((prev) => [...prev, cleanLog]);
          }
        },
        (status) => {
          setRunStatus(status.status as any);
          if (status.status !== 'running') {
            loadReports();
          }
        }
      );
    } catch (e) {
      console.error('Failed to start test:', e);
      setRunStatus('failed');
      setLogs((prev) => [...prev, `Error: ${e instanceof Error ? e.message : 'Failed to start'}`]);
    } finally {
      setIsStarting(false);
    }
  };

  // Stop test
  const handleStop = async () => {
    if (!runId) return;
    
    try {
      // Close SSE connection first
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      
      await stopRun(runId);
      setRunStatus('stopped');
    } catch (e) {
      console.error('Failed to stop test:', e);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unsubscribeRef.current?.();
    };
  }, []);

  // View report
  const handleViewReport = async (reportId: string) => {
    try {
      const report = await getReport(reportId);
      setSelectedReport(report);
      setSelectedReportId(reportId);
    } catch (e) {
      console.error('Failed to load report:', e);
    }
  };

  const handleCloseReport = () => {
    setSelectedReport(null);
    setSelectedReportId(null);
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  const isRunning = runStatus === 'running';

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col bg-[rgb(var(--surface))] overflow-hidden">
      <div className="p-4 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-slate-800">LongMemEval 长程记忆测试</h1>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                serverOnline === null
                  ? 'bg-slate-100 text-slate-500'
                  : serverOnline
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              {serverOnline === null ? '检测中...' : serverOnline ? '服务在线' : '服务离线'}
            </span>
          </div>
          {!serverOnline && serverOnline !== null && (
            <p className="text-sm text-slate-500">
              请运行: <code className="bg-slate-100 px-1.5 py-0.5 rounded">cd test/longmemeval-server && ./run.sh</code>
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden max-w-7xl mx-auto w-full">
        {/* Left Panel - Config & Controls */}
        <div className="w-80 border-r border-slate-200 bg-white p-4 flex flex-col gap-4 overflow-y-auto">
          {/* Test Configuration */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-700">测试配置</h2>
            
            <div>
              <label className="block text-xs text-slate-500 mb-1">测试用例数</label>
              <input
                type="number"
                value={config.limit || ''}
                onChange={(e) => setConfig({ ...config, limit: e.target.value ? parseInt(e.target.value) : undefined })}
                placeholder="全部"
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                disabled={isRunning}
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">每用例最大会话数</label>
              <input
                type="number"
                value={config.maxSessions || ''}
                onChange={(e) => setConfig({ ...config, maxSessions: e.target.value ? parseInt(e.target.value) : undefined })}
                placeholder="全部"
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                disabled={isRunning}
              />
            </div>

            {/* Fixed production-like settings */}
            <div className="p-3 bg-slate-50 rounded-lg text-xs text-slate-600 space-y-1">
              <div className="font-medium text-slate-700">固定配置 (production-like)</div>
              <div>并发数: 1</div>
              <div>K 值: 1, 3, 5, 10</div>
              <div>启用 QA: 否</div>
              <div>会话延迟: 是</div>
            </div>
          </div>

          {/* Control Buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleStart}
              disabled={!serverOnline || isRunning || isStarting}
              className="flex-1 px-4 py-2 bg-cyan-500 text-white rounded-lg font-medium text-sm hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isStarting ? '启动中...' : isRunning ? '运行中...' : '开始测试'}
            </button>
            {isRunning && (
              <button
                onClick={handleStop}
                className="px-4 py-2 bg-red-500 text-white rounded-lg font-medium text-sm hover:bg-red-600 transition-colors"
              >
                停止
              </button>
            )}
          </div>

          {/* Run Status */}
          {runStatus !== 'idle' && (
            <div className={`p-3 rounded-lg text-sm ${
              runStatus === 'running' ? 'bg-blue-50 text-blue-700' :
              runStatus === 'completed' ? 'bg-green-50 text-green-700' :
              runStatus === 'failed' ? 'bg-red-50 text-red-700' :
              'bg-slate-50 text-slate-600'
            }`}>
              状态: {runStatus === 'running' ? '运行中' : runStatus === 'completed' ? '完成' : runStatus === 'failed' ? '失败' : '已停止'}
              {runId && <span className="block text-xs mt-1 opacity-70">ID: {runId}</span>}
              {runStatus === 'failed' && (
                <span className="block text-xs mt-1 opacity-90">失败时也会生成报告，请点击下方「刷新」查看。</span>
              )}
            </div>
          )}

          {/* Reports List */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-700">历史报告</h2>
              <button
                onClick={loadReports}
                disabled={reportsLoading}
                className="text-xs text-cyan-600 hover:text-cyan-800"
              >
                刷新
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {reportsLoading && <p className="text-xs text-slate-500">加载中...</p>}
              {!reportsLoading && reports.length === 0 && (
                <p className="text-xs text-slate-500">暂无报告</p>
              )}
              {reports.map((report) => (
                <button
                  key={report.id}
                  onClick={() => handleViewReport(report.id)}
                  className={`w-full text-left p-2 rounded-lg border text-xs transition-colors ${
                    selectedReportId === report.id
                      ? 'border-cyan-300 bg-cyan-50'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="font-medium text-slate-700">{report.configType}</div>
                  <div className="text-slate-500">{report.timestamp}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Panel - Logs & Report */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Logs */}
          <div className="flex-1 flex flex-col min-h-0 border-b border-slate-200">
            <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">实时日志</h2>
              <button
                onClick={handleClearLogs}
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                清空
              </button>
            </div>
            
            {/* Status Bar - Queue always shown, runtime only when running */}
            <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center gap-6 text-xs font-mono">
              {isRunning && (
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">运行时间:</span>
                  <span className="text-cyan-400">
                    {Math.floor(elapsedSeconds / 60)}m{elapsedSeconds % 60}s
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Ingest 缓冲:</span>
                {queueStatus?.queue ? (
                  <span className={queueStatus.queue.ingestPending === 0 ? 'text-green-400' : 'text-yellow-400'}>
                    {queueStatus.queue.ingestPending}
                  </span>
                ) : (
                  <span className="text-slate-500">--</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Diffusion 队列:</span>
                {queueStatus?.queue ? (
                  <>
                    <span className="text-yellow-400">待处理: {queueStatus.queue.pending}</span>
                    <span className="text-orange-400">确认中: {queueStatus.queue.ackPending}</span>
                    <span className={queueStatus.queue.total === 0 ? 'text-green-400' : 'text-white'}>
                      总计: {queueStatus.queue.total}
                    </span>
                  </>
                ) : (
                  <span className="text-slate-500">获取中...</span>
                )}
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto bg-slate-900 p-4 font-mono text-xs">
              {logs.length === 0 ? (
                <p className="text-slate-500">等待测试启动...</p>
              ) : (
                logs.map((log, i) => (
                  <div
                    key={i}
                    className={`whitespace-pre-wrap break-all ${
                      log.includes('[stderr]') ? 'text-red-400' :
                      log.includes('✓') || log.includes('Passed') ? 'text-green-400' :
                      log.includes('✗') || log.includes('Failed') || log.includes('Error') ? 'text-red-400' :
                      log.includes('->') ? 'text-slate-500' :
                      'text-slate-300'
                    }`}
                  >
                    {log}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>

          {/* Report Detail */}
          {selectedReport && (
            <div className="h-1/2 flex flex-col border-t border-slate-200">
              <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">
                  报告详情 - {selectedReport.json.metadata?.config_type || 'unknown'}
                </h2>
                <button
                  onClick={handleCloseReport}
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  关闭
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 bg-white">
                <div className="grid grid-cols-4 gap-4 mb-4">
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <div className="text-xs text-slate-500 mb-1">总用例</div>
                    <div className="text-lg font-semibold text-slate-800">{selectedReport.json.total_cases}</div>
                  </div>
                  <div className="p-3 bg-green-50 rounded-lg">
                    <div className="text-xs text-green-600 mb-1">通过</div>
                    <div className="text-lg font-semibold text-green-700">{selectedReport.json.passed}</div>
                  </div>
                  <div className="p-3 bg-red-50 rounded-lg">
                    <div className="text-xs text-red-600 mb-1">失败</div>
                    <div className="text-lg font-semibold text-red-700">{selectedReport.json.failed}</div>
                  </div>
                  {selectedReport.json.longmemeval_metrics?.retrieval && (
                    <div className="p-3 bg-cyan-50 rounded-lg">
                      <div className="text-xs text-cyan-600 mb-1">Recall@1</div>
                      <div className="text-lg font-semibold text-cyan-700">
                        {((selectedReport.json.longmemeval_metrics.retrieval.recall_at_k['1'] || 0) * 100).toFixed(1)}%
                      </div>
                    </div>
                  )}
                </div>

                {selectedReport.json.longmemeval_metrics?.retrieval && (
                  <div className="mb-4">
                    <h3 className="text-sm font-medium text-slate-700 mb-2">召回率 (Recall@K)</h3>
                    <div className="flex gap-4">
                      {Object.entries(selectedReport.json.longmemeval_metrics.retrieval.recall_at_k)
                        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                        .map(([k, v]) => (
                          <div key={k} className="text-center">
                            <div className="text-xs text-slate-500">@{k}</div>
                            <div className="text-sm font-medium text-slate-700">{(v * 100).toFixed(1)}%</div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {selectedReport.json.longmemeval_metrics?.qa && (
                  <div className="mb-4">
                    <h3 className="text-sm font-medium text-slate-700 mb-2">QA 准确率</h3>
                    <div className="flex gap-4">
                      <div className="text-center">
                        <div className="text-xs text-slate-500">准确率</div>
                        <div className="text-sm font-medium text-slate-700">
                          {(selectedReport.json.longmemeval_metrics.qa.accuracy * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-slate-500">精确匹配</div>
                        <div className="text-sm font-medium text-slate-700">
                          {selectedReport.json.longmemeval_metrics.qa.exact_match}/{selectedReport.json.longmemeval_metrics.qa.total_questions}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {selectedReport.json.metadata && (
                  <div className="text-xs text-slate-500">
                    <p>生成时间: {selectedReport.json.metadata.generated_at}</p>
                    <p>Git Tag: {selectedReport.json.metadata.git_tag}</p>
                  </div>
                )}

                {selectedReport.json.metadata?.run_log && (
                  <div className="mt-4 border-t border-slate-200 pt-4">
                    <details className="group">
                      <summary className="cursor-pointer text-sm font-medium text-slate-700 list-none flex items-center gap-2">
                        <span className="group-open:rotate-90 transition-transform">▶</span>
                        进一步分析（测试过程终端日志）
                      </summary>
                      <pre className="mt-2 p-3 bg-slate-900 text-slate-300 text-xs font-mono rounded-lg overflow-x-auto overflow-y-auto max-h-64 whitespace-pre-wrap break-all">
                        {selectedReport.json.metadata.run_log}
                      </pre>
                    </details>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
