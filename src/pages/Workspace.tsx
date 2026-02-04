import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAuthStore } from '../stores/auth.js';
import { useConversationStore } from '../stores/conversation.js';
import { useInboxNotifyStore } from '../stores/inboxNotify.js';
import { getSessions, getMessages } from '../api/conversation.js';
import { getInboxItems } from '../api/inbox.js';
import { postAgentRun, consumeAgentStream } from '../api/llm.js';
import { useEvents } from '../hooks/useEvents.js';
import { listNotes, createNote, updateNote, deleteNote } from '../api/notes.js';
import { listDocuments, uploadDocument, getDocument, deleteDocument } from '../api/documents.js';
import { ensureMemory } from '../api/memory.js';
import type { Session, Message } from '../api/conversation.js';
import type { InboxItem } from '../api/inbox.js';
import type { Note } from '../api/notes.js';
import type { DocumentItem } from '../api/documents.js';

/** Placeholder sessionId when no chat session is selected; keeps SSE open so inbox.new still arrives */
const INBOX_ONLY_SESSION_ID = '00000000-0000-0000-0000-000000000001';

const getLocale = (): string =>
  (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : 'zh-CN';

/** Format note updatedAt: short date + time, localized */
function formatNoteTime(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(getLocale(), {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** Format last_message_at: time only, localized */
function formatSessionTime(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(getLocale(), { timeStyle: 'medium' }).format(d);
}

/** Format message timestamp: date + time, localized */
function formatMessageTimestamp(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'long',
    timeStyle: 'medium',
  }).format(d);
}

/** Format optional ISO or date string for display (e.g. inbox stored_at), localized */
function formatStoredAt(value: string | undefined): string | null {
  if (value == null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(d);
}

/** Group label for a date: today / yesterday / day before / formatted date, localized */
function getDateGroupLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  const ty = today.getFullYear();
  const tm = today.getMonth();
  const tday = today.getDate();

  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  if (y === ty && m === tm && day === tday) return rtf.format(0, 'day');
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (y === yesterday.getFullYear() && m === yesterday.getMonth() && day === yesterday.getDate()) return rtf.format(-1, 'day');
  const dayBefore = new Date(today);
  dayBefore.setDate(dayBefore.getDate() - 2);
  if (y === dayBefore.getFullYear() && m === dayBefore.getMonth() && day === dayBefore.getDate()) return rtf.format(-2, 'day');
  return new Intl.DateTimeFormat(getLocale(), { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
}

/** Group sessions by date (today, yesterday, day before, then date string). Order: today first, then yesterday, etc. */
function groupSessionsByDate(sessions: Session[]): { dateLabel: string; sessions: Session[] }[] {
  const map = new Map<string, Session[]>();
  const firstSeen: string[] = [];
  for (const s of sessions) {
    const label = getDateGroupLabel(s.last_message_at);
    if (!map.has(label)) {
      map.set(label, []);
      firstSeen.push(label);
    }
    map.get(label)!.push(s);
  }
  const priority: Record<string, number> = { 今天: 0, 昨天: 1, 前天: 2 };
  const withIndex = firstSeen.map((label, i) => ({ label, i }));
  withIndex.sort((a, b) => {
    const pa = priority[a.label] ?? 999;
    const pb = priority[b.label] ?? 999;
    if (pa !== pb) return pa - pb;
    return a.i - b.i;
  });
  return withIndex.map(({ label }) => ({ dateLabel: label, sessions: map.get(label)! }));
}

export function Workspace() {
  const user_id = useAuthStore((s) => s.user_id);
  const {
    sessions,
    currentSessionId,
    setSessions,
    setCurrentSessionId,
    messages,
    setMessages,
    hasMoreMessages,
    totalInSession,
    appendMessage,
    streamingContent,
    setStreamingContent,
    appendStreamingContent,
  } = useConversationStore();

  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesNextToken, setNotesNextToken] = useState<string | null>(null);
  const [notesCurrentToken, setNotesCurrentToken] = useState<string | null>(null);
  const [notesPrevTokens, setNotesPrevTokens] = useState<(string | null)[]>([]);
  const [addingNote, setAddingNote] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState('');
  /** 从 AI 消息添加笔记弹窗：当前选中的消息；弹窗内可编辑内容 */
  const [addNoteFromMessage, setAddNoteFromMessage] = useState<Message | null>(null);
  const [addNoteFromMessageContent, setAddNoteFromMessageContent] = useState('');
  const [addNoteFromMessageSaving, setAddNoteFromMessageSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsNextToken, setDocsNextToken] = useState<string | null>(null);
  const [docsCurrentToken, setDocsCurrentToken] = useState<string | null>(null);
  const [docsPrevTokens, setDocsPrevTokens] = useState<(string | null)[]>([]);
  const [docsTotal, setDocsTotal] = useState<number | null>(null);
  const [deleteConfirmDocId, setDeleteConfirmDocId] = useState<string | null>(null);
  const docsFileInputRef = useRef<HTMLInputElement>(null);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [inboxTotal, setInboxTotal] = useState(0);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [latestNewMessages, setLatestNewMessages] = useState<Array<{ content: string; stored_at?: string }>>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [expandedMessageMemories, setExpandedMessageMemories] = useState<Set<string>>(new Set());
  const [rememberLoading, setRememberLoading] = useState<string | null>(null);
  const [rememberDone, setRememberDone] = useState<Set<string>>(new Set());

  const sessionId = currentSessionId;
  const clearInboxNew = useInboxNotifyStore((s) => s.clearInboxNew);
  const hasNewInbox = useInboxNotifyStore((s) => s.hasNewInbox);

  const MAX_LATEST_NEW = 5;

  const onInboxNew = useCallback((data?: { preview?: string; content?: string; message?: { content?: string } | string; stored_at?: string }) => {
    useInboxNotifyStore.getState().setInboxNew();
    const content =
      data?.preview ??
      data?.content ??
      (typeof data?.message === 'object' && data?.message?.content != null
        ? data.message.content
        : typeof data?.message === 'string'
          ? data.message
          : '');
    setLatestNewMessages((prev) =>
      [{ content: String(content || ''), stored_at: data?.stored_at }, ...prev].slice(0, MAX_LATEST_NEW)
    );
    setInboxTotal((prev) => prev + 1);
  }, []);

  useEvents(sessionId ?? INBOX_ONLY_SESSION_ID, undefined, onInboxNew);

  useEffect(() => {
    clearInboxNew();
    setLatestNewMessages([]);
  }, [clearInboxNew]);

  useEffect(() => {
    if (!user_id) return;
    getSessions(user_id, 20, 0).then((r) => {
      setSessions(r.sessions, r.total, r.has_more);
      const current = useConversationStore.getState().currentSessionId;
      if (r.sessions.length > 0 && !current) {
        setCurrentSessionId(r.sessions[0].session_id);
      }
    }).catch(console.error);
  }, [user_id, setSessions, setCurrentSessionId]);

  useEffect(() => {
    if (!currentSessionId) {
      setMessages([], false, 0);
      setMessagesLoading(false);
      return;
    }
    setMessagesLoading(true);
    getMessages(currentSessionId, 20, 0)
      .then((r) => {
        setMessages(r.messages, r.has_more, r.total_in_session);
      })
      .catch((err) => {
        console.error('[Workspace] getMessages failed', err);
        setMessages([], false, 0);
      })
      .finally(() => {
        setMessagesLoading(false);
      });
  }, [currentSessionId, setMessages]);

  useEffect(() => {
    if (!sessionId) setExpandedMessageMemories(new Set());
  }, [sessionId]);

  const NOTES_PAGE_SIZE = 8;

  const loadNotes = useCallback((pageToken?: string | null) => {
    setNotesLoading(true);
    listNotes({ page_size: NOTES_PAGE_SIZE, sort: 'desc', page_token: pageToken || undefined })
      .then((r) => {
        setNotes(r.items || []);
        setNotesNextToken(r.next_page_token ?? null);
        setNotesCurrentToken(pageToken ?? null);
        if (pageToken == null) setNotesPrevTokens([]);
      })
      .catch(console.error)
      .finally(() => setNotesLoading(false));
  }, []);

  const handleNotesPrevPage = useCallback(() => {
    if (notesPrevTokens.length === 0) return;
    const prev = notesPrevTokens[notesPrevTokens.length - 1];
    setNotesPrevTokens((p) => p.slice(0, -1));
    loadNotes(prev ?? undefined);
  }, [notesPrevTokens, loadNotes]);

  const handleNotesNextPage = useCallback(() => {
    if (!notesNextToken) return;
    setNotesPrevTokens((p) => [...p, notesCurrentToken]);
    loadNotes(notesNextToken);
  }, [notesNextToken, notesCurrentToken, loadNotes]);

  const DOCS_PAGE_SIZE = 8;

  const loadDocs = useCallback((pageToken?: string | null) => {
    setDocsLoading(true);
    listDocuments({ page_size: DOCS_PAGE_SIZE, sort: 'desc', page_token: pageToken || undefined })
      .then((r) => {
        setDocs(r.items || []);
        setDocsNextToken(r.next_page_token ?? null);
        setDocsCurrentToken(pageToken ?? null);
        if (pageToken == null) setDocsPrevTokens([]);
        if (r.total !== undefined) setDocsTotal(r.total);
      })
      .catch(console.error)
      .finally(() => setDocsLoading(false));
  }, []);

  const handleDocsPrevPage = useCallback(() => {
    if (docsPrevTokens.length === 0) return;
    const prev = docsPrevTokens[docsPrevTokens.length - 1];
    setDocsPrevTokens((p) => p.slice(0, -1));
    loadDocs(prev ?? undefined);
  }, [docsPrevTokens, loadDocs]);

  const handleDocsNextPage = useCallback(() => {
    if (!docsNextToken) return;
    setDocsPrevTokens((p) => [...p, docsCurrentToken]);
    loadDocs(docsNextToken);
  }, [docsNextToken, docsCurrentToken, loadDocs]);

  const handleUploadDoc = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('file', file, file.name);
      formData.append('name', file.name);
      uploadDocument(formData)
        .then(() => {
          loadDocs();
        })
        .catch((err) => {
          console.error('[Workspace] uploadDocument failed', err);
          alert(err instanceof Error ? err.message : '上传失败');
        })
        .finally(() => {
          e.target.value = '';
        });
    },
    [loadDocs]
  );

  const handleDownloadDoc = useCallback((id: string) => {
    const w = window.open('', '_blank');
    getDocument(id)
      .then((doc) => {
        if (w && doc.storageUrl) w.location.href = doc.storageUrl;
        else if (w) w.close();
        if (!doc.storageUrl) alert('暂无下载地址');
      })
      .catch((err) => {
        if (w) w.close();
        console.error('[Workspace] getDocument failed', err);
        alert(err instanceof Error ? err.message : '获取下载链接失败');
      });
  }, []);

  const handleDeleteDoc = useCallback(
    async (id: string) => {
      try {
        await deleteDocument(id);
        setDeleteConfirmDocId(null);
        loadDocs();
      } catch (err) {
        console.error('[Workspace] deleteDocument failed', err);
        alert(err instanceof Error ? err.message : '删除失败');
      }
    },
    [loadDocs]
  );

  useEffect(() => {
    loadNotes();
    loadDocs();
  }, [loadNotes, loadDocs]);

  useEffect(() => {
    if (!user_id) return;
    setInboxLoading(true);
    getInboxItems(user_id, { limit: 20, offset: 0, exclude_channels: 'ag-ui' })
      .then((r) => {
        setInboxItems(r.items || []);
        setInboxTotal(r.total);
      })
      .catch(console.error)
      .finally(() => setInboxLoading(false));
  }, [user_id]);

  const handleNewSession = useCallback(() => {
    const id = crypto.randomUUID();
    setCurrentSessionId(id);
    setMessages([], false, 0);
  }, [setCurrentSessionId, setMessages]);

  const handleSelectSession = useCallback((id: string) => {
    if (id === currentSessionId) return;
    setMessagesLoading(true);
    setCurrentSessionId(id);
  }, [setCurrentSessionId, currentSessionId]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !user_id || !sessionId) {
      console.warn('[Workspace] handleSend 跳过: 缺少 text / user_id / sessionId', { hasText: !!text, user_id, sessionId });
      return;
    }
    console.log('[Workspace] handleSend 调用', { sessionId, textLen: text.length });
    setInput('');
    setSending(true);
    setStreamingContent('');
    appendMessage({
      message_id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    });
    try {
      console.log('[Workspace] POST /agent', { sessionId, messageCount: messages.length + 1 });
      const res = await postAgentRun({
        method: 'agent/run',
        params: { agentId: 'default' },
        body: {
          threadId: sessionId,
          messages: [...messages, { role: 'user', content: text }].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          runId: crypto.randomUUID(),
        },
      });
      console.log('[Workspace] POST /agent response', res.status, res.headers.get('content-type'));

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message || res.statusText || `请求失败 ${res.status}`);
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream')) {
        console.log('[Workspace] 响应为 SSE 流，从 POST 响应体读取');
        await consumeAgentStream(
          res,
          (chunk) => appendStreamingContent(chunk),
          (full) => {
            appendMessage({
              message_id: crypto.randomUUID(),
              role: 'assistant',
              content: full,
              timestamp: new Date().toISOString(),
            });
            setStreamingContent(null);
          }
        );
        console.log('[Workspace] SSE 流读取完成');
      } else {
        console.log('[Workspace] 响应为 JSON，流式结果将经 GET /events 推送');
      }

      if (user_id) {
        getSessions(user_id, 20, 0).then((r) => setSessions(r.sessions, r.total, r.has_more)).catch(console.error);
      }
    } catch (e) {
      console.error('[Workspace] 发消息失败', e);
      appendMessage({
        message_id: crypto.randomUUID(),
        role: 'assistant',
        content: e instanceof Error ? e.message : '发送失败，请重试。',
        timestamp: new Date().toISOString(),
      });
    } finally {
      setSending(false);
    }
  }, [input, user_id, sessionId, messages, appendMessage, setStreamingContent, appendStreamingContent]);

  const handleRemember = useCallback(
    async (m: Message) => {
      if (!user_id || !m.content?.trim()) return;
      setRememberLoading(m.message_id);
      try {
        const result = await ensureMemory({
          user_id,
          content: m.content.trim(),
          kind: 'fact',
          session_id: sessionId ?? undefined,
          source_message_id: m.message_id,
        });
        // Backend is synchronous: response reflects final outcome. Only mark "已记住" when actually stored.
        const stored = result.status === 'saved' || result.status === 'updated' || result.status === 'duplicate';
        if (stored) {
          setRememberDone((prev) => new Set(prev).add(m.message_id));
          if (result.memory_id) {
            const updated = messages.map((msg) =>
              msg.message_id === m.message_id
                ? {
                    ...msg,
                    memories: [
                      ...(msg.memories ?? []),
                      { memory_id: result.memory_id!, content: m.content, memory_type: 'semantic' },
                    ],
                  }
                : msg
            );
            setMessages(updated, hasMoreMessages, totalInSession);
          }
        } else {
          // blocked or consent_required: show reason, do not mark as remembered
          alert(result.reason || '无法保存该记忆');
        }
      } catch (e) {
        console.error('[Workspace] ensureMemory failed', e);
        alert(e instanceof Error ? e.message : '保存记忆失败');
      } finally {
        setRememberLoading(null);
      }
    },
    [user_id, sessionId, messages, hasMoreMessages, totalInSession, setMessages]
  );

  const sessionTitle = (s: Session) => {
    if (s.message_count === 0) return '新对话';
    if (s.last_message) return s.last_message.length > 40 ? `${s.last_message.slice(0, 40)}…` : s.last_message;
    return `会话 ${s.session_id.slice(0, 8)}…`;
  };

  const handleAddNote = useCallback(() => {
    setAddingNote(true);
    setNewNoteContent('');
  }, []);

  const handleSaveNewNote = useCallback(async () => {
    const content = newNoteContent.trim();
    if (!content) return;
    try {
      await createNote(content);
      setAddingNote(false);
      setNewNoteContent('');
      loadNotes();
    } catch (e) {
      console.error('[Workspace] createNote failed', e);
      alert(e instanceof Error ? e.message : '添加失败');
    }
  }, [newNoteContent, loadNotes]);

  const handleCancelAddNote = useCallback(() => {
    setAddingNote(false);
    setNewNoteContent('');
  }, []);

  const handleAddNoteFromMessage = useCallback((m: Message) => {
    setAddNoteFromMessage(m);
    setAddNoteFromMessageContent(m.content ?? '');
  }, []);

  const handleSaveAddNoteFromMessage = useCallback(async () => {
    const content = addNoteFromMessageContent.trim();
    if (!content || !addNoteFromMessage) return;
    setAddNoteFromMessageSaving(true);
    try {
      await createNote(content);
      setAddNoteFromMessage(null);
      setAddNoteFromMessageContent('');
      loadNotes();
    } catch (e) {
      console.error('[Workspace] createNote from message failed', e);
      alert(e instanceof Error ? e.message : '添加失败');
    } finally {
      setAddNoteFromMessageSaving(false);
    }
  }, [addNoteFromMessage, addNoteFromMessageContent, loadNotes]);

  const handleCancelAddNoteFromMessage = useCallback(() => {
    setAddNoteFromMessage(null);
    setAddNoteFromMessageContent('');
  }, []);

  const handleStartEditNote = useCallback((n: Note) => {
    setEditingNoteId(n.id);
    setEditingNoteContent(n.content);
  }, []);

  const handleSaveEditNote = useCallback(async () => {
    if (!editingNoteId) return;
    const content = editingNoteContent.trim();
    if (!content) return;
    try {
      await updateNote(editingNoteId, content);
      setEditingNoteId(null);
      setEditingNoteContent('');
      loadNotes();
    } catch (e) {
      console.error('[Workspace] updateNote failed', e);
      alert(e instanceof Error ? e.message : '保存失败');
    }
  }, [editingNoteId, editingNoteContent, loadNotes]);

  const handleCancelEditNote = useCallback(() => {
    setEditingNoteId(null);
    setEditingNoteContent('');
  }, []);

  const handleDeleteNote = useCallback(async (id: string) => {
    try {
      await deleteNote(id);
      setDeleteConfirmId(null);
      if (editingNoteId === id) {
        setEditingNoteId(null);
        setEditingNoteContent('');
      }
      loadNotes();
    } catch (e) {
      console.error('[Workspace] deleteNote failed', e);
      alert(e instanceof Error ? e.message : '删除失败');
    }
  }, [editingNoteId, loadNotes]);

  const groupedSessions = useMemo(() => groupSessionsByDate(sessions), [sessions]);

  return (
    <div className="h-[calc(100vh-3rem)] flex justify-center bg-[rgb(var(--surface))]">
      <div className="w-full max-w-7xl h-full flex bg-[rgb(var(--surface))] min-w-0">
      <aside className="w-64 shrink-0 border-r border-slate-200/80 bg-white flex flex-col overflow-hidden shadow-sm">
        {/* 会话列表 2/3 */}
        <div className="flex-[2] min-h-0 flex flex-col">
          <button
            type="button"
            onClick={handleNewSession}
            className="m-2.5 px-3 py-2 rounded-lg text-sm font-medium text-cyan-600 bg-cyan-50 hover:bg-cyan-100 border border-cyan-200/60 shrink-0 transition-colors"
          >
            + 新会话
          </button>
          <ul className="flex-1 overflow-auto min-h-0 px-1.5">
            {groupedSessions.map(({ dateLabel, sessions: groupSessions }) => (
              <li key={dateLabel} className="mt-2 first:mt-0">
                <div className="px-2.5 py-1 text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                  {dateLabel}
                </div>
                {groupSessions.map((s) => (
                  <div key={s.session_id} className="px-0.5">
                    <button
                      type="button"
                      onClick={() => handleSelectSession(s.session_id)}
                      className={`w-full text-left px-2.5 py-2 text-sm rounded-lg transition-colors ${
                        s.session_id === currentSessionId
                          ? 'bg-cyan-50 text-slate-800 border-l-2 border-cyan-500'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <div className="truncate">{sessionTitle(s)}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {formatSessionTime(s.last_message_at)}
                      </div>
                    </button>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </div>
        {/* 消息 1/3 */}
        <div className="flex-[1] min-h-0 flex flex-col border-t border-slate-200/80">
          <div className="px-3 py-2 text-[11px] font-medium text-slate-400 uppercase tracking-wider shrink-0 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              消息
            </span>
            <span className="normal-case font-semibold text-cyan-600 bg-cyan-50 px-2 py-0.5 rounded-md">{inboxTotal}</span>
          </div>
          {hasNewInbox && (
            <div className="mx-2 mt-1 mb-0.5 px-2.5 py-1.5 rounded-lg bg-cyan-50 border border-cyan-200/60 flex items-center justify-between shrink-0">
              <span className="text-xs font-medium text-cyan-700">有新消息</span>
              <button
                type="button"
                onClick={() => {
                  clearInboxNew();
                  setLatestNewMessages([]);
                }}
                className="text-xs text-cyan-600 hover:text-cyan-800"
              >
                知道了
              </button>
            </div>
          )}
          <ul className="flex-1 overflow-auto min-h-0 px-2 pb-2 space-y-1.5">
            {inboxLoading && <li className="text-xs text-slate-500 py-1">加载中…</li>}
            {!inboxLoading && latestNewMessages.length === 0 && inboxItems.length === 0 && (
              <li className="text-xs text-slate-500 py-1">暂无消息</li>
            )}
            {latestNewMessages.map((msg, i) => {
              const storedAtStr = formatStoredAt(msg.stored_at);
              return (
                <li key={i} className="text-xs border border-cyan-200/80 rounded-lg p-2 break-words bg-cyan-50/80 text-cyan-800">
                  <p className="line-clamp-2">{msg.content}</p>
                  {storedAtStr && <p className="text-cyan-600 mt-0.5">{storedAtStr}</p>}
                </li>
              );
            })}
            {!inboxLoading && inboxItems.map((item) => {
              const storedAtStr = formatStoredAt(item.stored_at);
              return (
                <li key={item.inbox_item_id} className="text-xs border border-slate-100 rounded-lg p-2 bg-slate-50/80 text-slate-700 break-words">
                  <p className="line-clamp-2">
                    {item.message?.content ?? JSON.stringify(item.message ?? item)}
                  </p>
                  {storedAtStr && <p className="text-slate-400 mt-0.5">{storedAtStr}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      </aside>
      <section className="flex-1 flex flex-col min-w-0 bg-[rgb(var(--surface))]">
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {messagesLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500 text-sm">
              <span className="inline-block w-6 h-6 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mb-2" aria-hidden />
              加载中…
            </div>
          )}
          {!messagesLoading && messages.length === 0 && !streamingContent && (
            <div className="flex flex-col items-center justify-center py-16 text-center max-w-sm mx-auto">
              <div className="w-14 h-14 rounded-2xl bg-cyan-100 flex items-center justify-center text-cyan-500 mb-4" aria-hidden>
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
              </div>
              <p className="text-slate-600 font-medium mb-1">有什么可以帮您？</p>
              <p className="text-slate-400 text-sm">在下方输入您的问题或想法，我会随时为您效劳。</p>
            </div>
          )}
          {!messagesLoading && messages.map((m: Message) => {
            const msgMemories = m.memories ?? [];
            const hasMemories = msgMemories.length > 0;
            const expanded = expandedMessageMemories.has(m.message_id);
            return (
              <div key={m.message_id} className={`${m.role === 'user' ? 'mr-auto' : 'ml-auto'} max-w-[80%] w-fit min-w-[4rem]`}>
                <div
                  className={`rounded-xl px-4 py-2.5 shadow-sm ${
                    m.role === 'user'
                      ? 'bg-cyan-500 text-white'
                      : 'bg-white border border-slate-200/80 text-slate-700'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 font-normal" aria-hidden>
                  {formatMessageTimestamp(m.timestamp)}
                </p>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  {hasMemories && (
                    <button
                      type="button"
                      onClick={() => setExpandedMessageMemories((prev) => {
                        const next = new Set(prev);
                        if (next.has(m.message_id)) next.delete(m.message_id);
                        else next.add(m.message_id);
                        return next;
                      })}
                      className="text-[11px] text-cyan-600 hover:underline"
                    >
                      {expanded ? '收起' : `产生了 ${msgMemories.length} 条记忆`}
                    </button>
                  )}
                  {m.role === 'user' && !hasMemories && (
                    <button
                      type="button"
                      onClick={() => handleRemember(m)}
                      disabled={!!rememberLoading || rememberDone.has(m.message_id)}
                      className="text-[11px] text-slate-500 hover:text-cyan-600 hover:underline disabled:opacity-60 disabled:cursor-default"
                      title="将这条消息保存为记忆"
                    >
                      {rememberLoading === m.message_id
                        ? '保存中…'
                        : rememberDone.has(m.message_id)
                          ? '已记住'
                          : '请记住'}
                    </button>
                  )}
                  {m.role === 'assistant' && (
                    <button
                      type="button"
                      onClick={() => handleAddNoteFromMessage(m)}
                      className="text-[11px] text-slate-500 hover:text-cyan-600 hover:underline"
                      title="将回答保存为笔记"
                    >
                      添加笔记
                    </button>
                  )}
                </div>
                {hasMemories && expanded && (
                  <ul className="mt-1.5 space-y-1 pl-2 border-l-2 border-slate-200">
                    {msgMemories.map((mem) => (
                      <li key={mem.memory_id} className="text-xs text-slate-600">
                        {mem.content}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {!messagesLoading && streamingContent && (
            <div className="ml-auto max-w-[80%] w-fit min-w-[4rem]">
              <div className="rounded-xl px-4 py-2.5 bg-white border border-slate-200/80 shadow-sm">
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{streamingContent}</p>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 font-normal" aria-hidden>
                {formatMessageTimestamp(new Date().toISOString())}
              </p>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-slate-200/80 bg-white/80 backdrop-blur-sm flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="输入消息，或描述您的问题…"
            className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 ring-accent"
            disabled={sending}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="px-5 py-2.5 bg-cyan-500 text-white rounded-xl font-medium text-sm hover:bg-cyan-600 disabled:opacity-50 transition-colors shadow-sm"
          >
            {sending ? '发送中…' : '发送'}
          </button>
        </div>
      </section>
      <aside className="w-72 shrink-0 border-l border-slate-200/80 bg-white flex flex-col overflow-hidden shadow-sm">
        <div className="pl-3 pr-2 py-2.5 border-b border-cyan-200/80 bg-cyan-50/70 border-l-2 border-l-cyan-500 flex items-center justify-between shrink-0">
          <span className="text-xs font-semibold text-slate-700 flex items-center gap-2">
            <svg className="w-4 h-4 text-cyan-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            投资笔记
            {!notesLoading && notesPrevTokens.length === 0 && (notes.length > 0 || notesNextToken) && (
              <span className="font-semibold text-cyan-600 bg-cyan-100/80 px-1.5 py-0.5 rounded-md text-[11px]">
                {notesNextToken ? `${notes.length}+` : notes.length}
              </span>
            )}
          </span>
          {!addingNote && (
            <button
              type="button"
              onClick={handleAddNote}
              className="p-1.5 rounded-lg border border-cyan-200/80 bg-white hover:bg-cyan-100 hover:border-cyan-300 text-cyan-600 transition-colors"
              title="添加笔记"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            </button>
          )}
        </div>
        <div className="flex-1 overflow-auto min-h-0 p-2 space-y-2">
          {addingNote && (
            <div className="border border-slate-200/80 rounded-xl px-2.5 py-2 bg-slate-50/80 space-y-2 shrink-0">
              <textarea
                value={newNoteContent}
                onChange={(e) => setNewNoteContent(e.target.value)}
                placeholder="记下想法或要点…"
                rows={2}
                className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500"
              />
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={handleSaveNewNote}
                  disabled={!newNoteContent.trim()}
                  className="text-[11px] px-2.5 py-1 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 disabled:opacity-50"
                >
                  保存
                </button>
                <button type="button" onClick={handleCancelAddNote} className="text-[11px] px-2.5 py-1 border border-slate-200 rounded-lg hover:bg-slate-50">
                  取消
                </button>
              </div>
            </div>
          )}
          {notesLoading && <p className="text-[11px] text-slate-500 py-1">加载中…</p>}
          {!notesLoading && notes.length === 0 && !addingNote && (
            <p className="text-[11px] text-slate-500 py-1">暂无笔记，点击上方 + 添加</p>
          )}
          {notes.map((n) => (
            <div key={n.id} className="border border-slate-200/80 rounded-xl px-2.5 py-2 bg-white shadow-sm shrink-0 hover:border-slate-300/80 transition-colors">
              {editingNoteId === n.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editingNoteContent}
                    onChange={(e) => setEditingNoteContent(e.target.value)}
                    rows={2}
                    className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500"
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={handleSaveEditNote}
                      disabled={!editingNoteContent.trim()}
                      className="text-[11px] px-2.5 py-1 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 disabled:opacity-50"
                    >
                      保存
                    </button>
                    <button type="button" onClick={handleCancelEditNote} className="text-[11px] px-2.5 py-1 border border-slate-200 rounded-lg hover:bg-slate-50">
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 items-start">
                  <button
                    type="button"
                    onClick={() => handleStartEditNote(n)}
                    className="flex-1 min-w-0 text-left py-0.5"
                  >
                    <p className="line-clamp-2 break-words text-xs text-slate-800 leading-tight">{n.content || '(空)'}</p>
                    <p className="text-[10px] text-slate-400 mt-1">{formatNoteTime(n.updatedAt)}</p>
                  </button>
                  <div className="shrink-0 flex flex-col items-end gap-0.5">
                    {deleteConfirmId === n.id ? (
                      <>
                        <span className="text-[10px] text-slate-500 whitespace-nowrap">删除？</span>
                        <div className="flex gap-0.5">
                          <button
                            type="button"
                            onClick={() => handleDeleteNote(n.id)}
                            className="p-0.5 rounded bg-red-100 text-red-700 hover:bg-red-200"
                            title="确定"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(null)}
                            className="p-0.5 rounded border hover:bg-slate-50"
                            title="取消"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(n.id); }}
                        className="p-0.5 rounded text-slate-400 hover:bg-red-50 hover:text-red-600"
                        title="删除"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
          {(notesPrevTokens.length > 0 || notesNextToken) && (
            <div className="flex items-center justify-between gap-1.5 pt-2 shrink-0 border-t border-slate-100 mt-1">
              <button
                type="button"
                disabled={notesPrevTokens.length === 0}
                onClick={handleNotesPrevPage}
                className="text-[11px] px-2 py-1 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                上一页
              </button>
              <button
                type="button"
                disabled={!notesNextToken}
                onClick={handleNotesNextPage}
                className="text-[11px] px-2 py-1 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                下一页
              </button>
            </div>
          )}
        </div>
        <div className="pl-3 pr-2 py-2.5 border-t-2 border-slate-200 border-b border-slate-200/80 bg-slate-100/80 border-l-2 border-l-slate-500 flex items-center justify-between shrink-0">
          <span className="text-xs font-semibold text-slate-700 flex items-center gap-2">
            <svg className="w-4 h-4 text-slate-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            工作档案
            {docsTotal != null && (
              <span className="font-semibold text-slate-600 bg-slate-200/80 px-1.5 py-0.5 rounded-md text-[11px]">
                {docsTotal}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => docsFileInputRef.current?.click()}
            className="p-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-200 hover:border-slate-400 text-slate-600 transition-colors"
            title="上传"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
          </button>
        </div>
        <input
          ref={docsFileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp,.svg,.txt,.csv,.md"
          onChange={handleUploadDoc}
          aria-hidden
        />
        <div className="flex-1 overflow-auto min-h-0 p-2 space-y-2">
          {docsLoading && <p className="text-[11px] text-slate-500 py-1">加载中…</p>}
          {!docsLoading && docs.length === 0 && (
            <p className="text-[11px] text-slate-500 py-1">暂无文档，点击上方上传</p>
          )}
          {docs.map((d) => (
            <div key={d.id} className="border border-slate-200/80 rounded-lg px-2 py-1.5 bg-white shadow-sm shrink-0 flex items-center gap-2 min-w-0 hover:border-slate-300/80 transition-colors">
              <button
                type="button"
                onClick={() => handleDownloadDoc(d.id)}
                className="flex-1 min-w-0 text-left flex items-center gap-2"
              >
                <span className="truncate text-xs text-slate-800" title={d.name}>{d.name}</span>
                {d.updatedAt && (
                  <span className="shrink-0 text-[10px] text-slate-400 whitespace-nowrap">{formatNoteTime(d.updatedAt)}</span>
                )}
              </button>
              <div className="shrink-0 flex items-center gap-0.5">
                {deleteConfirmDocId === d.id ? (
                  <>
                    <span className="text-[10px] text-slate-500 whitespace-nowrap">删除？</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteDoc(d.id)}
                      className="p-0.5 rounded bg-red-100 text-red-700 hover:bg-red-200"
                      title="确定"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmDocId(null)}
                      className="p-0.5 rounded border hover:bg-slate-50"
                      title="取消"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmDocId(d.id)}
                    className="p-0.5 rounded text-slate-400 hover:bg-red-50 hover:text-red-600"
                    title="删除"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                )}
              </div>
            </div>
          ))}
          {(docsPrevTokens.length > 0 || docsNextToken) && (
            <div className="flex items-center justify-between gap-1.5 pt-2 shrink-0 border-t border-slate-100 mt-1">
              <button
                type="button"
                disabled={docsPrevTokens.length === 0}
                onClick={handleDocsPrevPage}
                className="text-[11px] px-2 py-1 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                上一页
              </button>
              <button
                type="button"
                disabled={!docsNextToken}
                onClick={handleDocsNextPage}
                className="text-[11px] px-2 py-1 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      </aside>
      </div>
      {/* 从 AI 消息添加笔记弹窗 */}
      {addNoteFromMessage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={handleCancelAddNoteFromMessage}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-note-from-message-title"
        >
          <div
            className="bg-white rounded-xl shadow-lg border border-slate-200 w-full max-w-lg flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="add-note-from-message-title" className="px-4 py-3 border-b border-slate-200 font-medium text-slate-800">
              添加笔记
            </h2>
            <textarea
              className="flex-1 min-h-[120px] p-4 text-sm text-slate-700 border-0 resize-none focus:ring-0 focus:outline-none"
              placeholder="笔记内容（默认为大模型回答，可修改）"
              value={addNoteFromMessageContent}
              onChange={(e) => setAddNoteFromMessageContent(e.target.value)}
              autoFocus
            />
            <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelAddNoteFromMessage}
                className="text-sm px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveAddNoteFromMessage}
                disabled={!addNoteFromMessageContent.trim() || addNoteFromMessageSaving}
                className="text-sm px-3 py-1.5 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {addNoteFromMessageSaving ? '保存中…' : '确定'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
