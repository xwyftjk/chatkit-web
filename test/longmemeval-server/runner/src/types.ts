import { z } from 'zod';

/**
 * LongMemEval-specific step types
 */
export const LongMemEvalStepSchema = z.discriminatedUnion('action', [
  z.object({
    step: z.number(),
    action: z.literal('ingest'),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
    timestamp: z.string().optional(),
    description: z.string().optional(),
    _longmemeval_session_id: z.string().optional(),
    _chatkit_session_id: z.string().optional(),
    /** Delay in milliseconds before sending this message (for realistic pacing) */
    delay_before_ms: z.number().optional(),
  }),
  z.object({
    step: z.number(),
    action: z.literal('wait_for_diffusion'),
    timeout_ms: z.number().default(0),  // 0 = no timeout, wait until complete
    poll_interval_ms: z.number().default(2000),
    description: z.string().optional(),
  }),
  z.object({
    step: z.number(),
    action: z.literal('verify_longmemeval_retrieval'),
    query: z.string(),
    expected_answer: z.string().optional(),  // The expected answer text for content-based matching
    expected_answer_session_ids: z.array(z.string()),
    k_values: z.array(z.number()).optional(),
    description: z.string().optional(),
    _session_id_mapping: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    step: z.number(),
    action: z.literal('verify_longmemeval_qa'),
    query: z.string(),
    expected_answer: z.string(),
    llm_adapter_url: z.string().optional(),
    description: z.string().optional(),
  }),
]);

export const LongMemEvalTestCaseSchema = z.object({
  test_case_id: z.string(),
  category: z.string(),
  description: z.string(),
  user_id: z.string(),
  steps: z.array(LongMemEvalStepSchema),
  _longmemeval_metadata: z.object({
    question_id: z.string(),
    question_type: z.string(),
    answer_session_ids: z.array(z.string()),
  }).optional(),
});

export type LongMemEvalStep = z.infer<typeof LongMemEvalStepSchema>;
export type LongMemEvalTestCase = z.infer<typeof LongMemEvalTestCaseSchema>;
export type LongMemEvalTestSuite = LongMemEvalTestCase[];
