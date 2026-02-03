/**
 * LLM API: chat completions (trigger only; stream comes via /events or POST response body).
 */

import { fetchApi } from './client.js';

export type ChatMessage = { role: string; content: string };

export async function postChatCompletions(
  messages: ChatMessage[],
  options?: { model?: string; stream?: boolean; max_tokens?: number }
): Promise<Response> {
  return fetchApi('/llm/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      model: options?.model ?? 'default',
      stream: options?.stream ?? false,
      max_tokens: options?.max_tokens ?? 1024,
    }),
  });
}

/**
 * Trigger agent run. When no GET /events connection exists, backend streams via POST response body.
 */
export type AgentRunPayload = {
  method: string;
  params?: { agentId?: string };
  body?: { threadId: string; messages: ChatMessage[]; runId?: string };
};

export async function postAgentRun(payload: AgentRunPayload): Promise<Response> {
  return fetchApi('/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * Consume SSE stream from POST /agent response body (when backend uses postStream mode).
 */
export async function consumeAgentStream(
  res: Response,
  onChunk: (content: string) => void,
  onDone: (fullContent: string) => void
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const raw = line.slice(6).trim();
          if (!raw || raw === '[DONE]') continue;
          try {
            const data = JSON.parse(raw) as { type?: string; content?: string; text?: string; event?: string; finish_reason?: string };
            const content = data.content ?? data.text;
            if (typeof content === 'string') {
              fullContent += content;
              onChunk(content);
            }
            if (data.event === 'done' || data.finish_reason) {
              if (fullContent) onDone(fullContent);
              return;
            }
          } catch {
            // skip non-JSON lines (e.g. comments)
          }
        }
      }
    }
    if (fullContent) onDone(fullContent);
  } finally {
    reader.releaseLock();
  }
}
