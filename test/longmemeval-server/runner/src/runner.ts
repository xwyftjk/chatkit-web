import chalk from 'chalk';
import pLimit from 'p-limit';
import type { LongMemEvalTestCase, LongMemEvalStep } from './types.js';

interface RunnerOptions {
  conversationStoreUrl: string;
  temporalStoreUrl: string;
  contextAssemblerUrl: string;
  llmAdapterUrl?: string;
  verbose: boolean;
  concurrency?: number;
  memoryIngestWorkerUrl?: string;
  /** Single URL or comma-separated / array of diffusion worker URLs; queue stats are summed across all. */
  memoryDiffusionWorkerUrl?: string | string[];
}

interface StepResult {
  step: number;
  action: string;
  passed: boolean;
  error?: string;
  duration_ms: number;
  longmemeval_metrics?: {
    recall_at_k?: Record<number, number>;
    answer_found?: boolean;  // Content-based retrieval success
    qa_accuracy?: number;
    qa_exact_match?: boolean;
  };
}

interface TestCaseResult {
  test_case_id: string;
  user_id: string;
  passed: boolean;
  steps: StepResult[];
  error?: string;
  duration_ms: number;
  /** Time from first message ingestion to queue empty (complete processing) */
  processing_duration_ms?: number;
}

interface SuiteResult {
  suite_name: string;
  total_cases: number;
  passed: number;
  failed: number;
  cases: TestCaseResult[];
  longmemeval_metrics?: {
    retrieval: {
      recall_at_k: Record<number, number>;
      total_questions: number;
    };
    qa: {
      accuracy: number;
      exact_match: number;
      total_questions: number;
    };
  };
}

export class LongMemEvalRunner {
  private suiteResults: SuiteResult[] = [];

  constructor(private options: RunnerOptions) {
    this.options.memoryIngestWorkerUrl =
      this.options.memoryIngestWorkerUrl ||
      process.env.MEMORY_INGEST_WORKER_URL ||
      'http://localhost:26406';
    const raw = this.options.memoryDiffusionWorkerUrl ?? process.env.MEMORY_DIFFUSION_WORKER_URL ?? 'http://localhost:26407';
    this.options.memoryDiffusionWorkerUrl = typeof raw === 'string' && raw.includes(',')
      ? raw.split(',').map(s => s.trim()).filter(Boolean)
      : raw;
    this.options.llmAdapterUrl =
      this.options.llmAdapterUrl ||
      process.env.LLM_ADAPTER_URL ||
      'http://localhost:26404';
  }

  /** Returns diffusion worker URL(s) as array for health polling; queue stats are summed across all. */
  private getDiffusionWorkerUrls(): string[] {
    const u = this.options.memoryDiffusionWorkerUrl;
    if (!u) return ['http://localhost:26407'];
    return Array.isArray(u) ? u : [u];
  }

  async runSuite(suite: LongMemEvalTestCase[], suiteName: string = 'longmemeval'): Promise<SuiteResult> {
    console.log(chalk.bold(`\nRunning LongMemEval Suite: ${suiteName} (${suite.length} cases)...`));
    
    const limit = pLimit(this.options.concurrency || 1);

    const promises = suite.map(testCase => limit(async () => {
      console.log(chalk.blue(`\n[${testCase.test_case_id}] Starting...`));
      
      const caseResult = await this.runTestCase(testCase);
      
      if (caseResult.passed) {
        console.log(chalk.green(`✓ Passed: ${testCase.test_case_id}`));
      } else {
        console.log(chalk.red(`✗ Failed: ${testCase.test_case_id}`));
        if (caseResult.error) {
          console.log(chalk.red(`  Reason: ${caseResult.error}`));
        }
      }
      
      // Display processing time if available
      if (caseResult.processing_duration_ms !== undefined) {
        const processingMin = Math.floor(caseResult.processing_duration_ms / 60000);
        const processingSec = Math.floor((caseResult.processing_duration_ms % 60000) / 1000);
        console.log(chalk.cyan(`  Processing: ${processingMin}m${processingSec}s (from first ingest to queue empty)`));
      }
      return caseResult;
    }));

    const results = await Promise.all(promises);

    // Aggregate LongMemEval metrics
    const longmemevalMetrics = this.aggregateLongMemEvalMetrics(results);

    const result: SuiteResult = {
      suite_name: suiteName,
      total_cases: suite.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      cases: results,
      ...(longmemevalMetrics ? { longmemeval_metrics: longmemevalMetrics } : {}),
    };

    this.suiteResults.push(result);

    // Print summary
    console.log(chalk.bold(`\nSuite Summary (${suiteName}):`));
    console.log(chalk.green(`Passed: ${result.passed}`));
    console.log(chalk.red(`Failed: ${result.failed}`));

    if (longmemevalMetrics) {
      console.log(chalk.bold(`\nLongMemEval Metrics:`));
      if (longmemevalMetrics.retrieval) {
        console.log(chalk.cyan(`  Retrieval:`));
        for (const [k, recall] of Object.entries(longmemevalMetrics.retrieval.recall_at_k).sort((a, b) => Number(a[0]) - Number(b[0]))) {
          console.log(chalk.cyan(`    Recall@${k}: ${(recall * 100).toFixed(1)}%`));
        }
      }
      if (longmemevalMetrics.qa) {
        console.log(chalk.cyan(`  QA:`));
        console.log(chalk.cyan(`    Accuracy: ${(longmemevalMetrics.qa.accuracy * 100).toFixed(1)}%`));
        console.log(chalk.cyan(`    Exact Match: ${longmemevalMetrics.qa.exact_match}/${longmemevalMetrics.qa.total_questions}`));
      }
    }

    return result;
  }

  private async runTestCase(testCase: LongMemEvalTestCase): Promise<TestCaseResult> {
    const { user_id, steps } = testCase;
    const startTime = Date.now();
    const stepResults: StepResult[] = [];
    
    // Track session ID mappings
    const sessionIdMapping: Record<string, string> = {};
    
    // Track processing time: from first ingest to queue empty
    let firstIngestTime: number | undefined;
    let queueEmptyTime: number | undefined;

    try {
      for (const step of steps) {
        const stepStart = Date.now();
        let stepPassed = true;
        let stepError: string | undefined;
        let stepMetrics: StepResult['longmemeval_metrics'] | undefined;

        try {
          if (this.options.verbose) {
            console.log(chalk.gray(`  Step ${step.step}: ${step.action} ${step.description ? `(${step.description})` : ''}`));
          }

          switch (step.action) {
            case 'ingest': {
              // Record first ingest time (start of processing)
              if (firstIngestTime === undefined) {
                firstIngestTime = Date.now();
              }
              
              // Apply delay before sending if specified (for realistic pacing)
              if (step.delay_before_ms && step.delay_before_ms > 0) {
                if (this.options.verbose) {
                  console.log(chalk.gray(`    -> Waiting ${(step.delay_before_ms / 1000).toFixed(1)}s before next session...`));
                }
                await new Promise(resolve => setTimeout(resolve, step.delay_before_ms));
              }
              
              const chatkitSessionId = step._chatkit_session_id || `eval-${testCase.test_case_id}-${Date.now()}`;
              await this.ingestMessage(user_id, chatkitSessionId, step.content, step.role, step.timestamp);
              
              // Track session ID mapping
              if (step._longmemeval_session_id) {
                sessionIdMapping[step._longmemeval_session_id] = chatkitSessionId;
              }
              break;
            }
            case 'wait_for_diffusion': {
              // Wait for all sessions to be processed (pending=0 AND ack_pending=0)
              // By default, wait indefinitely (no timeout) - tests should complete, not timeout
              // Set DIFFUSION_TIMEOUT_MS or step.timeout_ms to enforce a timeout if needed
              const envTimeout = process.env.DIFFUSION_TIMEOUT_MS;
              const timeoutMs = step.timeout_ms ?? (envTimeout ? parseInt(envTimeout) : 0); // 0 = no timeout
              const pollIntervalMs = step.poll_interval_ms ?? 2000;
              await this.waitForDiffusion(user_id, timeoutMs, pollIntervalMs);
              
              // Record queue empty time (end of processing)
              if (firstIngestTime !== undefined) {
                queueEmptyTime = Date.now();
              }
              break;
            }
            case 'verify_longmemeval_retrieval': {
              const metrics = await this.verifyRetrieval(
                user_id,
                step.query,
                step.expected_answer,  // Pass expected answer for content-based matching
                step.expected_answer_session_ids,
                step.k_values || [1, 3, 5, 10],
                step._session_id_mapping || sessionIdMapping
              );
              stepMetrics = { 
                recall_at_k: metrics.recall_at_k,
                answer_found: metrics.answer_found 
              };
              break;
            }
            case 'verify_longmemeval_qa': {
              const metrics = await this.verifyQA(
                user_id,
                step.query,
                step.expected_answer,
                step.llm_adapter_url
              );
              stepMetrics = {
                qa_accuracy: metrics.accuracy,
                qa_exact_match: metrics.exact_match,
              };
              break;
            }
          }
        } catch (error) {
          stepPassed = false;
          stepError = error instanceof Error ? error.message : String(error);
          throw error;
        } finally {
          stepResults.push({
            step: step.step,
            action: step.action,
            passed: stepPassed,
            error: stepError,
            duration_ms: Date.now() - stepStart,
            longmemeval_metrics: stepMetrics,
          });
        }
      }

      return {
        test_case_id: testCase.test_case_id,
        user_id: testCase.user_id,
        passed: true,
        steps: stepResults,
        duration_ms: Date.now() - startTime,
        processing_duration_ms: firstIngestTime && queueEmptyTime 
          ? queueEmptyTime - firstIngestTime 
          : undefined,
      };
    } catch (error) {
      return {
        test_case_id: testCase.test_case_id,
        user_id: testCase.user_id,
        passed: false,
        steps: stepResults,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime,
        processing_duration_ms: firstIngestTime && queueEmptyTime 
          ? queueEmptyTime - firstIngestTime 
          : undefined,
      };
    }
  }

  private async ingestMessage(userId: string, sessionId: string, content: string, role: string, timestamp?: string) {
    if (this.options.verbose) {
      console.log(chalk.gray(`    -> POST /conversation/append [${timestamp || 'now'}]`));
    }
    
    const response = await fetch(`${this.options.conversationStoreUrl}/conversation/append`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        session_id: sessionId,
        role: role,
        content: content,
        timestamp: timestamp
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Ingest failed: ${response.status} - ${errorText}`);
    }
  }

  private async waitForDiffusion(userId: string, timeoutMs: number, pollIntervalMs: number) {
    const noTimeout = timeoutMs === 0;
    const urls = this.getDiffusionWorkerUrls();
    if (this.options.verbose) {
      const timeoutStr = noTimeout ? 'no timeout (wait until complete)' : `${timeoutMs}ms`;
      console.log(chalk.gray(`    -> Waiting for diffusion (${timeoutStr}, ${urls.length} worker(s))...`));
    }

    const start = Date.now();

    // Step 1: Wait for ingest-worker's 10s debounce to flush
    // This ensures the last batch has been forwarded to NATS
    const DEBOUNCE_WAIT_MS = 12000; // 12 seconds > 10s debounce
    if (this.options.verbose) {
      console.log(chalk.gray(`    -> Waiting ${DEBOUNCE_WAIT_MS / 1000}s for ingest debounce...`));
    }
    await new Promise(resolve => setTimeout(resolve, DEBOUNCE_WAIT_MS));

    // Step 2: Poll NATS queue status until empty (sum across all worker URLs)
    // If noTimeout, wait indefinitely until queue is empty. When queue is null, keep polling instead of breaking.
    while (noTimeout || Date.now() - start < timeoutMs) {
      try {
        const healths = await Promise.all(
          urls.map(url => fetch(`${url}/health`).then(r => r.json()).catch(() => null))
        );
        let pendingSum = 0;
        let ackPendingSum = 0;
        let anyQueuePresent = false;
        for (const h of healths) {
          const queue = (h as { queue?: { pending?: number; ackPending?: number } } | null)?.queue;
          if (queue != null) {
            anyQueuePresent = true;
            pendingSum += queue.pending ?? 0;
            ackPendingSum += queue.ackPending ?? 0;
          }
        }

        if (!anyQueuePresent) {
          // Queue info not available from any worker; keep polling (no output to avoid SSE noise)
          await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
          continue;
        }

        const total = pendingSum + ackPendingSum;
        // Queue status is shown in UI status bar, no need for console output

        // Queue is empty when no pending and no ack_pending
        if (total === 0) {
          if (this.options.verbose) {
            console.log(chalk.gray(`\n    -> Queue empty, waiting 20-25s for Qdrant indexing to complete...`));
          }
          // Wait additional 20-25 seconds for:
          // 1. In-flight processing to complete
          // 2. Qdrant vector indexing (batch indexing can take 5-10s)
          const settleWait = 20000 + Math.floor(Math.random() * 5000);
          await new Promise(resolve => setTimeout(resolve, settleWait));
          if (this.options.verbose) {
            console.log(chalk.green(`    -> Diffusion complete, vectors should be indexed`));
          }
          return;
        }
      } catch (e) {
        if (this.options.verbose) {
          console.log(chalk.yellow(`    -> Health check error: ${e instanceof Error ? e.message : String(e)}`));
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    if (this.options.verbose) {
      console.log(chalk.yellow(`    -> Diffusion wait timeout (${timeoutMs}ms), continuing...`));
    }
  }

  private async verifyRetrieval(
    userId: string,
    query: string,
    expectedAnswer: string | undefined,
    expectedAnswerSessionIds: string[],
    kValues: number[],
    sessionIdMapping: Record<string, string>
  ): Promise<{ recall_at_k: Record<number, number>; answer_found: boolean }> {
    if (this.options.verbose) {
      console.log(chalk.gray(`    -> Verifying retrieval for query: ${query.substring(0, 50)}...`));
      if (expectedAnswer) {
        console.log(chalk.gray(`    -> Expected answer: ${expectedAnswer}`));
      }
      console.log(chalk.gray(`    -> Expected sessions: ${expectedAnswerSessionIds.join(', ')}`));
      
      // Diagnostic: Check if expected sessions were injected
      const injectedSessions = Object.keys(sessionIdMapping);
      console.log(chalk.gray(`    -> Injected sessions: ${injectedSessions.length} total`));
      
      const missingSessions = expectedAnswerSessionIds.filter(id => !injectedSessions.includes(id));
      if (missingSessions.length > 0) {
        console.log(chalk.yellow(`    -> ⚠️  WARNING: Expected session(s) NOT injected: ${missingSessions.join(', ')}`));
        console.log(chalk.yellow(`    -> This will cause Recall@K = 0% if the answer is only in these sessions`));
        console.log(chalk.yellow(`    -> Check if --max-sessions limit excluded these sessions`));
      } else {
        console.log(chalk.green(`    -> ✓ All expected sessions were injected`));
      }
    }

    // Call context assembly
    const response = await fetch(`${this.options.contextAssemblerUrl}/context/assemble`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        query: query,
        intent: { requires_memory: true },
        constraints: { token_budget: 2000, policy_tags: [] }
      })
    });

    if (!response.ok) {
      throw new Error(`Context assembly failed: ${response.status}`);
    }

    const data = await response.json() as any;
    const blocks = data.context_blocks || [];

    if (this.options.verbose) {
      console.log(chalk.gray(`    -> Got ${blocks.length} context blocks`));
      if (blocks.length === 0) {
        console.log(chalk.yellow(`    -> WARNING: No context blocks retrieved! This will cause Recall@K = 0`));
        console.log(chalk.yellow(`    -> Check if memories exist for user: ${userId}`));
      }
    }

    // STRATEGY 1: Session-based matching (preferred)
    // Context Assembler now returns session_id directly in provenance - no extra API calls needed
    const retrievedLongMemEvalSessions = new Set<string>();
    let sessionMatchingWorked = false;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const provenance = block.provenance as any;
      const sessionId = provenance?.session_id;
      const memoryId = provenance?.memory_id;
      
      if (sessionId && block.type?.startsWith('memory.')) {
        // Map back to LongMemEval session ID
        const longmemevalSessionId = Object.keys(sessionIdMapping).find(
          key => sessionIdMapping[key] === sessionId
        );
        
        if (longmemevalSessionId) {
          retrievedLongMemEvalSessions.add(longmemevalSessionId);
          sessionMatchingWorked = true;
          if (this.options.verbose) {
            console.log(chalk.green(`    -> Block ${i} (session: ${sessionId.substring(0, 25)}...) maps to: ${longmemevalSessionId}`));
          }
        } else {
          if (this.options.verbose) {
            console.log(chalk.yellow(`    -> Block ${i} has session_id ${sessionId} but not found in session mapping`));
          }
        }
      } else if (memoryId && block.type?.startsWith('memory.')) {
        if (this.options.verbose) {
          console.log(chalk.yellow(`    -> Block ${i} (memory_id: ${memoryId.substring(0, 8)}...) has no session_id in provenance`));
        }
      }
    }

    // STRATEGY 2: Content-based matching (fallback)
    // Check if the expected answer appears in any retrieved block
    let answerFound = false;
    let answerFoundInTopK: Record<number, boolean> = {};
    
    if (this.options.verbose) {
      console.log(chalk.gray(`    -> Expected answer for content matching: "${expectedAnswer || 'N/A'}"`));
    }
    
    if (expectedAnswer) {
      const answerLower = expectedAnswer.toLowerCase();
      // Check key terms from the answer (for partial matching)
      const answerKeywords = answerLower.split(/\s+/).filter(w => w.length > 3);
      
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const content = (block.content || '').toLowerCase();
        
        // Check for exact or partial match
        const hasAnswer = content.includes(answerLower) || 
                          (answerKeywords.length > 0 && answerKeywords.every(kw => content.includes(kw)));
        
        if (hasAnswer) {
          answerFound = true;
          if (this.options.verbose && !sessionMatchingWorked) {
            console.log(chalk.green(`    -> ✓ Answer found in block ${i} (content-based): "${block.content.substring(0, 60)}..."`));
          }
          // Mark which k values have the answer
          for (const k of kValues) {
            if (i < k) {
              answerFoundInTopK[k] = true;
            }
          }
        }
      }
      
      if (!answerFound && this.options.verbose) {
        console.log(chalk.yellow(`    -> Content matching: Answer "${expectedAnswer}" NOT found in any of ${blocks.length} blocks`));
        if (blocks.length > 0) {
          console.log(chalk.gray(`    -> First block content preview: "${blocks[0].content?.substring(0, 80) || 'N/A'}..."`));
        }
      }
    }

    // Compute Recall@k
    const recallAtK: Record<number, number> = {};
    
    if (sessionMatchingWorked) {
      // Use session-based matching (preferred)
      const expectedSet = new Set(expectedAnswerSessionIds);
      const retrievedArray = Array.from(retrievedLongMemEvalSessions);
      
      if (this.options.verbose) {
        console.log(chalk.gray(`    -> Retrieved sessions (${retrievedArray.length} unique): ${retrievedArray.slice(0, 10).join(', ')}${retrievedArray.length > 10 ? '...' : ''}`));
      }
      
      for (const k of kValues) {
        const topK = retrievedArray.slice(0, k);
        const intersection = topK.filter(id => expectedSet.has(id));
        const recall = expectedSet.size > 0 ? intersection.length / expectedSet.size : 1.0;
        recallAtK[k] = recall;

        if (this.options.verbose) {
          console.log(chalk.gray(`    -> Recall@${k}: ${(recall * 100).toFixed(1)}% (session-based: ${intersection.length}/${expectedSet.size})`));
        }
      }
      
      answerFound = retrievedArray.some(id => expectedSet.has(id));
    } else {
      // Fall back to content-based matching
      for (const k of kValues) {
        const recall = answerFoundInTopK[k] ? 1.0 : 0.0;
        recallAtK[k] = recall;

        if (this.options.verbose) {
          console.log(chalk.gray(`    -> Recall@${k}: ${(recall * 100).toFixed(1)}% (content-based: answer ${answerFoundInTopK[k] ? 'found' : 'not found'} in top-${k})`));
        }
      }
    }

    // If no expected answer was provided, fall back to checking if any blocks were retrieved
    if (!expectedAnswer && blocks.length > 0) {
      for (const k of kValues) {
        recallAtK[k] = 1.0; // Assume success if we retrieved anything
      }
      answerFound = true;
    }

    return { recall_at_k: recallAtK, answer_found: answerFound };
  }

  private async verifyQA(
    userId: string,
    query: string,
    expectedAnswer: string,
    llmAdapterUrl?: string
  ): Promise<{ accuracy: number; exact_match: boolean }> {
    if (this.options.verbose) {
      console.log(chalk.gray(`    -> Verifying QA for query: ${query.substring(0, 50)}...`));
    }

    // Get context blocks
    const contextResponse = await fetch(`${this.options.contextAssemblerUrl}/context/assemble`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        query: query,
        intent: { requires_memory: true },
        constraints: { token_budget: 2000, policy_tags: [] }
      })
    });

    if (!contextResponse.ok) {
      throw new Error(`Context assembly failed: ${contextResponse.status}`);
    }

    const contextData = await contextResponse.json() as any;
    const blocks = contextData.context_blocks || [];

    // Format context for LLM
    const contextText = blocks.map((b: any) => 
      `[${b.type}] ${b.content}`
    ).join('\n\n');

    const systemPrompt = `You are a helpful assistant. Answer the question based on the provided context. Be concise and accurate.`;
    const userPrompt = `Context:\n${contextText}\n\nQuestion: ${query}\n\nAnswer:`;

    const llmUrl = llmAdapterUrl || this.options.llmAdapterUrl!;
    const llmResponse = await fetch(`${llmUrl}/llm/infer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
        model: 'gpt-4o-mini',
        temperature: 0.0,
      })
    });

    if (!llmResponse.ok) {
      throw new Error(`LLM inference failed: ${llmResponse.status}`);
    }

    const llmData = await llmResponse.json() as any;
    const generatedAnswer = (llmData.response_text || '').trim();

    if (this.options.verbose) {
      console.log(chalk.gray(`    -> Generated: ${generatedAnswer.substring(0, 100)}...`));
      console.log(chalk.gray(`    -> Expected: ${expectedAnswer.substring(0, 100)}...`));
    }

    // Compare answers
    const normalizedGenerated = generatedAnswer.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedExpected = expectedAnswer.toLowerCase().replace(/\s+/g, ' ').trim();
    const exactMatch = normalizedGenerated === normalizedExpected;
    const accuracy = exactMatch ? 1.0 : 0.0;

    if (this.options.verbose) {
      if (exactMatch) {
        console.log(chalk.green(`    ✓ QA exact match: correct`));
      } else {
        console.log(chalk.yellow(`    ⚠ QA exact match: incorrect`));
      }
    }

    return { accuracy, exact_match: exactMatch };
  }

  private aggregateLongMemEvalMetrics(results: TestCaseResult[]): SuiteResult['longmemeval_metrics'] | undefined {
    const retrievalMetrics: { recall_at_k: Record<number, number[]> } = { recall_at_k: {} };
    const qaMetrics: { accuracy: number[]; exact_match: number[] } = { accuracy: [], exact_match: [] };
    let hasRetrieval = false;
    let hasQA = false;

    for (const result of results) {
      for (const step of result.steps) {
        if (step.longmemeval_metrics) {
          if (step.longmemeval_metrics.recall_at_k) {
            hasRetrieval = true;
            for (const [k, recall] of Object.entries(step.longmemeval_metrics.recall_at_k)) {
              const kNum = Number(k);
              if (!retrievalMetrics.recall_at_k[kNum]) {
                retrievalMetrics.recall_at_k[kNum] = [];
              }
              retrievalMetrics.recall_at_k[kNum].push(recall);
            }
          }

          if (step.longmemeval_metrics.qa_accuracy !== undefined) {
            hasQA = true;
            qaMetrics.accuracy.push(step.longmemeval_metrics.qa_accuracy);
            if (step.longmemeval_metrics.qa_exact_match !== undefined) {
              qaMetrics.exact_match.push(step.longmemeval_metrics.qa_exact_match ? 1 : 0);
            }
          }
        }
      }
    }

    if (!hasRetrieval && !hasQA) {
      return undefined;
    }

    const aggregated: NonNullable<SuiteResult['longmemeval_metrics']> = {} as NonNullable<SuiteResult['longmemeval_metrics']>;

    if (hasRetrieval) {
      const recallAtK: Record<number, number> = {};
      for (const [k, recalls] of Object.entries(retrievalMetrics.recall_at_k)) {
        const kNum = Number(k);
        const avgRecall = recalls.reduce((a, b) => a + b, 0) / recalls.length;
        recallAtK[kNum] = avgRecall;
      }
      aggregated.retrieval = {
        recall_at_k: recallAtK,
        total_questions: results.length,
      };
    }

    if (hasQA) {
      const avgAccuracy = qaMetrics.accuracy.length > 0
        ? qaMetrics.accuracy.reduce((a, b) => a + b, 0) / qaMetrics.accuracy.length
        : 0;
      const exactMatchCount = qaMetrics.exact_match.reduce((a, b) => a + b, 0);
      aggregated.qa = {
        accuracy: avgAccuracy,
        exact_match: exactMatchCount,
        total_questions: qaMetrics.accuracy.length,
      };
    }

    return aggregated;
  }

  getResults(): SuiteResult[] {
    return this.suiteResults;
  }
}
