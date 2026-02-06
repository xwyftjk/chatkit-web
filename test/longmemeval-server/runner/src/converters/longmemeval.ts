import { readFile } from 'fs/promises';
import type { LongMemEvalTestCase, LongMemEvalTestSuite } from '../types.js';

/**
 * LongMemEval dataset record structure
 */
export interface LongMemEvalRecord {
  question_id: string;
  question_type: string;
  question: string;
  question_date: string;
  answer: string;
  answer_session_ids: string[];  // Ground truth: which sessions contain answer
  haystack_session_ids: string[];
  haystack_dates: string[];
  haystack_sessions: Array<Array<{role: 'user' | 'assistant', content: string}>>;
}

export interface ConverterOptions {
  enableQA?: boolean;
  kValues?: number[];
  userPrefix?: string;
  runId?: string;  // Run identifier (auto-generated from timestamp if not provided)
  /** 
   * Enable realistic delay between messages based on timestamp gaps.
   * - Messages within 5 minutes: no delay (same batch)
   * - Messages > 5 minutes apart: random 12-20 second delay (separate batches)
   */
  enableRealisticDelay?: boolean;
  /**
   * Limit the number of sessions to process per test case.
   * If set, only the first N sessions will be ingested.
   * Useful for quick testing with a single session.
   */
  maxSessions?: number;
}

/**
 * Parse LongMemEval dataset JSON file
 */
export async function parseLongMemEvalDataset(jsonPath: string): Promise<LongMemEvalRecord[]> {
  const content = await readFile(jsonPath, 'utf-8');
  const data = JSON.parse(content);
  
  // Handle both array and object formats
  if (Array.isArray(data)) {
    return data;
  } else if (typeof data === 'object') {
    // If it's an object, convert to array
    return Object.values(data) as LongMemEvalRecord[];
  }
  
  throw new Error(`Invalid LongMemEval dataset format: expected array or object, got ${typeof data}`);
}

/**
 * Convert LongMemEval date string to ISO 8601 format
 * Input: "2023/05/20 (Sat) 02:21"
 * Output: "2023-05-20T02:21:00Z"
 */
export function parseHaystackDate(dateStr: string): string {
  // Match pattern: "2023/05/20 (Sat) 02:21"
  const match = dateStr.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+\([^)]+\)\s+(\d{2}):(\d{2})/);
  if (!match) {
    // Fallback: try to parse as ISO or use current time
    try {
      return new Date(dateStr).toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
  
  const [, year, month, day, hour, minute] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:00Z`;
}

/**
 * Generate a run ID from current timestamp
 * Format: YYMMDD-HHMMSS (e.g., 260126-143052)
 */
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

/**
 * Calculate delay before injecting a session.
 * - First session: no delay
 * - Subsequent sessions: 12-20 second delay to exceed 10s debounce threshold
 */
function calculateSessionDelay(isFirstSession: boolean): number {
  if (isFirstSession) {
    return 0;
  }
  // Random 12-20 second delay ensures separate batch processing
  return 12000 + Math.floor(Math.random() * 8000);
}

/**
 * Convert LongMemEval records to LongMemEval TestSuite format
 * 
 * User ID format: FG-GEN-U-{runId}-{question_id}
 * Example: FG-GEN-U-260126-143052-e47becba...
 */
export function convertToTestSuite(
  records: LongMemEvalRecord[],
  options: ConverterOptions = {}
): LongMemEvalTestSuite {
  const {
    enableQA = false,
    kValues = [1, 3, 5, 10],
    runId = generateRunId(),
    enableRealisticDelay = true,  // Default to true for realistic session pacing
    maxSessions,
  } = options;
  
  // Build userPrefix: FG-GEN-U-{runId}
  // If custom userPrefix is provided, use it; otherwise use FG-GEN-U-{runId}
  const userPrefix = options.userPrefix || `FG-GEN-U-${runId}`;

  const testCases: LongMemEvalTestCase[] = [];

  for (const record of records) {
    const testCaseId = `FG-GEN-${record.question_id.substring(0, 8).toUpperCase()}`;
    const userId = `${userPrefix}-${record.question_id}`;
    const steps: any[] = [];
    let stepNumber = 0;

    // Track session ID mappings for retrieval verification
    const sessionIdMapping: Record<string, string> = {};
    
    // Step 1: Ingest all haystack sessions
    // Use a unique ChatKit session ID for each LongMemEval session
    const sessionsToProcess = maxSessions 
      ? Math.min(maxSessions, record.haystack_sessions.length)
      : record.haystack_sessions.length;
    
    for (let i = 0; i < sessionsToProcess; i++) {
      const session = record.haystack_sessions[i];
      const longmemevalSessionId = record.haystack_session_ids[i];
      const dateStr = record.haystack_dates[i] || record.haystack_dates[0];
      const timestamp = parseHaystackDate(dateStr);
      
      // Calculate delay for first message of this session (skip first session)
      const sessionDelay = enableRealisticDelay 
        ? calculateSessionDelay(i === 0)
        : 0;
      
      // Generate a unique ChatKit session ID for this LongMemEval session
      const chatkitSessionId = `${testCaseId}-session-${i}-${longmemevalSessionId.substring(0, 8)}`;
      sessionIdMapping[longmemevalSessionId] = chatkitSessionId;

      // Parse base timestamp for this session
      const baseTimestamp = new Date(timestamp).getTime();
      
      // Ingest each message in the session
      // Generate incremental timestamps for messages within the session
      // Each message has a 2-15 second random interval from the previous message
      let cumulativeOffsetMs = 0;
      for (let msgIdx = 0; msgIdx < session.length; msgIdx++) {
        const message = session[msgIdx];
        // Only apply delay before the first message of a new session (for sending logic)
        const delayBeforeMs = (msgIdx === 0) ? sessionDelay : 0;
        
        // Generate incremental timestamp for this message
        // First message uses base timestamp, subsequent messages add 2-15 second random intervals
        if (msgIdx > 0) {
          // Random interval between 2-15 seconds (2000-15000 ms)
          const randomIntervalMs = 2000 + Math.floor(Math.random() * 13000);
          cumulativeOffsetMs += randomIntervalMs;
        }
        const messageTimestamp = new Date(baseTimestamp + cumulativeOffsetMs).toISOString();
        
        steps.push({
          step: stepNumber++,
          action: 'ingest',
          role: message.role,
          content: message.content,
          timestamp: messageTimestamp, // Use incremental timestamp instead of session timestamp
          description: `LongMemEval session: ${longmemevalSessionId}`,
          _longmemeval_session_id: longmemevalSessionId,
          _chatkit_session_id: chatkitSessionId,
          ...(delayBeforeMs > 0 ? { delay_before_ms: delayBeforeMs } : {}),
        });
      }
    }

    // Step 2: Wait for diffusion to process all sessions
    // timeout_ms: 0 = wait indefinitely until queue is empty (functional testing)
    steps.push({
      step: stepNumber++,
      action: 'wait_for_diffusion',
      timeout_ms: 0,  // No timeout - wait for all sessions to complete
      poll_interval_ms: 2000,
      description: 'Wait for diffusion pipeline to process all LongMemEval history sessions',
    });

    // Step 3: Verify retrieval recall
    // Note: We use content-based matching since memories don't track session provenance
    steps.push({
      step: stepNumber++,
      action: 'verify_longmemeval_retrieval',
      query: record.question,
      expected_answer: record.answer,  // The expected answer text for content matching
      expected_answer_session_ids: record.answer_session_ids,
      k_values: kValues,
      description: `LongMemEval retrieval verification for question: ${record.question.substring(0, 50)}...`,
      _session_id_mapping: sessionIdMapping,
    });

    // Step 4: Optionally verify QA accuracy
    if (enableQA) {
      steps.push({
        step: stepNumber++,
        action: 'verify_longmemeval_qa',
        query: record.question,
        expected_answer: record.answer,
        description: `LongMemEval QA verification for question: ${record.question.substring(0, 50)}...`,
      });
    }

    testCases.push({
      test_case_id: testCaseId,
      category: `LongMemEval-${record.question_type}`,
      description: `LongMemEval question: ${record.question.substring(0, 100)}...`,
      user_id: userId,
      steps: steps,
      _longmemeval_metadata: {
        question_id: record.question_id,
        question_type: record.question_type,
        answer_session_ids: record.answer_session_ids,
      },
    });
  }

  return testCases;
}
