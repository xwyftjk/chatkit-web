# ChatKit Web 接口参考（API Reference）

本文档描述 **ChatKit Web** 前端所调用的后端接口契约，并与本仓库 **`src/api/*.ts`** 实现保持一致。后端由 ChatKit Middleware（API Gateway、各服务）与 AI Infra（memory-store 等）提供。

**Base URL**：由环境变量 **`VITE_API_BASE_URL`** 配置（如开发时 `http://localhost:26100`）；未配置时为空（同源，依赖 Vite 代理或同域部署）。  
**鉴权**：除登录/注册外，所有请求通过 **`fetchApi()`**（`src/api/client.ts`）发起，自动携带 **`X-Request-ID`**（UUID）与 **`Authorization: Bearer <access_token>`**；401 时先尝试刷新令牌并重试，仍 401 则清除登录态并派发 `auth:logout`。

**文档结构**：

| 章 | 内容 |
|----|------|
| 一、认证与账号 | 登录、注册、刷新令牌 |
| 二、对话与消息 | 历史会话、Inbox、SSE 流 |
| 三、AI 问答 | Chat Completions、Agent 流式 |
| 四、用户内容 | 文档、笔记 |
| 五、记忆与画像 | 用户画像、长期记忆、时序图 |

---

## 一、认证与账号

### 1.1 用户注册 `POST /auth/register`

| 项 | 说明 |
|----|------|
| Request Body | `email` 或 `phone_number` 至少其一；`password`（必填，≥8 位）；可选 `name`、`username`、`code`。 |
| Response 201 | `user_id`、`email`、`email_verified`、`message`。 |
| Response 400 | `message` 示例：`该邮箱已被注册`、`密码长度至少 8 位` 等。 |

**本仓库实现**：`src/api/auth.ts` — `register(payload: RegisterPayload): Promise<RegisterResponse>`，请求体与上一致。

```ts
import { register } from '../api/auth.js';
const data = await register({ email: 'u@example.com', password: 'pass8chars', name: 'Name' });
// data.user_id, data.message
```

---

### 1.2 用户登录 `POST /auth/login`

| 项 | 说明 |
|----|------|
| Request Body | `email` 或 `username` 或 `phone_number` 至少其一；`password`（必填）。 |
| Response 200 | `user_id`、`access_token`、`refresh_token`、`expires_in`（秒）。 |
| Response 401 | `message` 示例：`账号或密码错误`、`请先验证您的邮箱`。 |

**本仓库实现**：`src/api/auth.ts` — `login(payload: LoginPayload): Promise<LoginResponse>`。

```ts
import { login } from '../api/auth.js';
const { user_id, access_token, refresh_token, expires_in } = await login({ email: 'u@example.com', password: '...' });
```

---

### 1.3 刷新令牌 `POST /auth/refresh`

| 项 | 说明 |
|----|------|
| Request Body | `refresh_token`。 |
| Response 200 | `access_token`、`refresh_token`（新）、`expires_in`。 |
| Response 401 | 无效或过期刷新令牌时清除登录态（在 `client.ts` 中处理）。 |

**本仓库实现**：`src/api/client.ts` — `refreshAccessToken()`，内部使用；401 时 `clearTokens()` 并派发 `auth:logout`。

---

## 二、对话与消息

### 2.1 历史会话列表 `GET /conversation/sessions`

| 项 | 说明 |
|----|------|
| Query | `user_id`（必填）、`limit`（可选，默认 20）、`offset`（可选，默认 0）。 |
| Response 200 | `sessions`（`session_id`、`last_message_at`、`message_count`、`last_message?`）、`total`、`has_more`。 |

**本仓库实现**：`src/api/conversation.ts` — `getSessions(userId, limit?, offset?)`。

```ts
import { getSessions } from '../api/conversation.js';
const { sessions, total, has_more } = await getSessions(user_id, 20, 0);
```

---

### 2.2 会话内容 `GET /conversation/messages`

| 项 | 说明 |
|----|------|
| Query | `session_id`（必填）、`limit`（可选，默认 20）、`offset`（可选，默认 0）。 |
| Response 200 | `messages`（`message_id`、`role`、`content`、`timestamp`、`memories?`）、`has_more`、`total_in_session`。 |

**本仓库实现**：`src/api/conversation.ts` — `getMessages(sessionId, limit?, offset?)`。后端可能为消息附带 `memories`（与 memory-store 对齐）。

```ts
import { getMessages } from '../api/conversation.js';
const { messages, has_more, total_in_session } = await getMessages(sessionId, 20, 0);
```

---

### 2.3 Inbox 消息列表 `GET /inbox/{user_id}/items`

| 项 | 说明 |
|----|------|
| Path | `user_id`。 |
| Query | `limit`（默认 50）、`offset`（默认 0）、`exclude_channels`（可选，逗号分隔）。 |
| Response 200 | `items`（`inbox_item_id`、`message`、`metadata`、`channels`、`stored_at`）、`total`、`has_more`。 |

**本仓库实现**：`src/api/inbox.ts` — `getInboxItems(userId, { limit?, offset?, exclude_channels? })`。

```ts
import { getInboxItems } from '../api/inbox.js';
const { items, total, has_more } = await getInboxItems(user_id, { limit: 20, offset: 0 });
```

---

### 2.4 SSE 流 `GET /events?sessionId=...`

| 项 | 说明 |
|----|------|
| Query | `sessionId`（必填，当前会话/线程）。 |
| Response | `Content-Type: text/event-stream`；同一连接上可收到 AI 流式事件与推送事件（如 `inbox.new`）。 |

**本仓库实现**：`src/api/events.ts` — 使用 **fetch + ReadableStream**（非 EventSource）以便携带 `Authorization`。`createEventSource(sessionId, onMessage, onError)` 返回 `{ close }` 用于断开。

```ts
import { createEventSource } from '../api/events.js';
const conn = createEventSource(sessionId, (data) => {
  if (data.type === 'inbox.new') { /* 刷新 Inbox */ }
  // AI 流式片段等按 type 处理
}, () => { /* 重连或降级 */ });
// 断开：conn.close();
```

---

## 三、AI 问答

### 3.1 Chat Completions `POST /llm/chat/completions`

| 项 | 说明 |
|----|------|
| Request Body | `messages`（必填，`{ role, content }[]`）；可选 `model`、`stream`、`max_tokens`。 |
| Response 200 | 非流式：`choices`、`usage`；流式时响应体为 SSE。 |

**本仓库实现**：`src/api/llm.ts` — `postChatCompletions(messages, { model?, stream?, max_tokens? }): Promise<Response>`。

```ts
import { postChatCompletions } from '../api/llm.js';
const res = await postChatCompletions(
  [{ role: 'user', content: 'Hello' }],
  { stream: false, max_tokens: 1024 }
);
```

---

### 3.2 Agent 流式 `POST /agent`

| 项 | 说明 |
|----|------|
| Request Body | 见后端 Agent 协议（如 `method`、`params`、`body` 含 `threadId`、`messages`、`runId`）。 |
| Response | 若未先建 GET /events，流式回复在 POST 响应体中（SSE）；若已建 /events，事件经同一条连接推送。 |

**本仓库实现**：`src/api/llm.ts` — `postAgentRun(payload): Promise<Response>`；流式消费 `consumeAgentStream(res, onChunk, onDone)`。

```ts
import { postAgentRun, consumeAgentStream } from '../api/llm.js';
const res = await postAgentRun({ method: 'run', body: { threadId: sessionId, messages } });
if (res.body) await consumeAgentStream(res, (chunk) => { ... }, (full) => { ... });
```

---

## 四、用户内容

### 4.1 文档服务

- **上传** `POST /api/documents`：`multipart/form-data`，`file` 必填；可选 `name`、`category`、`tags`。201 返回文档元数据（`id`、`name`、`storageUrl`、`fileSize` 等）。
- **列表** `GET /api/documents`：Query `page_size`、`page_token`、`sort`（asc/desc）。200 返回 `items`、`next_page_token`。
- **搜索** `GET /api/documents/search`：Query `q`（必填）、`page_size`、`sort`。
- **单条** `GET /api/documents/{id}`：200 返回完整文档元数据；404 不存在或非当前用户。
- **删除** `DELETE /api/documents/{id}`：204 成功。

**本仓库实现**：`src/api/documents.ts` — `uploadDocument(formData)`、`listDocuments(params?)`、`searchDocuments(q, params?)`、`getDocument(id)`、`deleteDocument(id)`。

```ts
import { uploadDocument, listDocuments, getDocument, deleteDocument } from '../api/documents.js';
const doc = await uploadDocument(formData);
const { items, next_page_token } = await listDocuments({ page_size: 20, sort: 'desc' });
```

---

### 4.2 笔记服务

- **创建** `POST /api/notes`：Body `{ content }`（必填，1–10000 字符）。201 返回 `id`、`userId`、`content`、`createdAt`、`updatedAt`。
- **列表** `GET /api/notes`：Query `page_size`、`page_token`、`sort`。200 返回 `items`、`next_page_token`。
- **单条** `GET /api/notes/{id}`：200 返回笔记对象；404 不存在或非当前用户。
- **更新** `PATCH /api/notes/{id}`：Body `{ content }`。200 返回更新后笔记。
- **删除** `DELETE /api/notes/{id}`：204 成功。

**本仓库实现**：`src/api/notes.ts` — `createNote(content)`、`listNotes(params?)`、`getNote(id)`、`updateNote(id, content)`、`deleteNote(id)`。

```ts
import { createNote, listNotes, updateNote, deleteNote } from '../api/notes.js';
const note = await createNote('今日观察…');
const { items, next_page_token } = await listNotes({ page_size: 20, sort: 'desc' });
```

---

## 五、记忆与画像

### 5.1 用户画像

- **获取** `GET /api/profile/{user_id}`：Path 的 `user_id` 须为当前登录用户（否则 403）。200 返回画像（`risk_tolerance`、`investment_horizon`、`asset_preferences`、`life_events`、`attributes` 等）；404 表示无画像（本仓库返回 `null`）。
- **更新** `PUT /api/profile/{user_id}`：Body 为部分字段。200 返回更新后画像。

**本仓库实现**：`src/api/profile.ts` — `getProfile(userId): Promise<Profile | null>`、`updateProfile(userId, body): Promise<Profile>`。

```ts
import { getProfile, updateProfile } from '../api/profile.js';
const profile = await getProfile(user_id);
if (profile) await updateProfile(user_id, { risk_tolerance: 'moderate' });
```

---

### 5.2 长期记忆（Memory Store）

- **列表** `GET /api/memory`：Query `limit`、`offset`、`memory_type`（episodic/semantic/procedural/emotional）；本仓库还支持 `session_id`、`created_after`、`created_before`、`fact_from`、`fact_to`。200 返回 `memories`、`total`、`has_more`。
- **搜索** `POST /api/memory/search`：Body `query`（必填）、`memory_types`、`limit`、`threshold`。200 返回 `memories`（含 `score?`）、`count`。
- **详情** `GET /api/memory/{memory_id}`：200 返回单条记忆；403/404 为无权限或不存在。
- **删除** `DELETE /api/memory/{memory_id}`：200 返回 `{ memory_id, deleted: true }`。
- **请记住（显式落库）** `POST /api/memory/ensure`：Body `user_id`、`content`（必填）、`kind?`、`session_id?`、`source_message_id?`。200 返回 `status`（saved/updated/duplicate/blocked/consent_required）、`reason`、`memory_id?`。仅当 status 为 saved/updated/duplicate 时视为已写入。
- **共激活（一层边）** `POST /api/hsg/coactivated`：Body `memory_id`、`limit`。200 返回 `memory_id`、`coactivated`（边列表）、`count`。
- **共激活相关（多跳完整记忆）** `GET /api/memory/by-id/{memory_id}/coactivated`：Query `hops`（1/2/3）、`limit`。200 返回 `memory_id`、`related`（完整 Memory 数组，含 `hop?`）、`related_ids`、`count`。

**本仓库实现**：`src/api/memory.ts` — `listMemories(params?)`、`searchMemories(query, params?)`、`getMemoryById(memoryId)`、`deleteMemory(memoryId)`、`ensureMemory(params)`、`getCoactivated(memoryId, limit?)`、`getCoactivatedRelated(memoryId, { hops?, limit? })`。

```ts
import { listMemories, searchMemories, ensureMemory, getCoactivatedRelated } from '../api/memory.js';
const { memories, total, has_more } = await listMemories({ limit: 20, memory_type: 'semantic', session_id: sessionId });
const { memories: hit } = await searchMemories('投资偏好', { limit: 10 });
const result = await ensureMemory({ user_id, content: '...', session_id, source_message_id });
const { related } = await getCoactivatedRelated(memoryId, { hops: 1 });
```

---

### 5.3 时序图（概念星图）

- **搜索** `POST /api/temporal/search`：Body `query`、`as_of_date`、`entity_types`、`limit`、`offset`；本仓库还传 `user_id`、`transaction_after`、`transaction_before`、`fact_from`、`fact_to`。200 返回 `entities`、`relations`、`count`、`total`、`as_of_date?`。
- **快照** `POST /api/temporal/snapshot`：Body `as_of_date`（必填）或空对象（本仓库传 `user_id?`）。200 返回 `user_id`、`as_of_date`、`entities`、`relations`。

**本仓库实现**：`src/api/memory.ts` — `temporalSearch(body: TemporalSearchParams)`、`temporalSnapshot(body?)`。

```ts
import { temporalSearch, temporalSnapshot } from '../api/memory.js';
const { entities, relations, count } = await temporalSearch({ user_id, query: '投资', limit: 50 });
const snap = await temporalSnapshot({});
```

---

## 附录：Base URL 与请求头

| 项 | 说明 |
|----|------|
| Base URL | 环境变量 `VITE_API_BASE_URL`；未设置时为空（同源）。 |
| 鉴权请求 | 通过 `fetchApi(path, init)` 发起，自动带 `X-Request-ID`（UUID）与 `Authorization: Bearer <access_token>`。 |
| 登录/注册 | 使用 `fetchApi(..., { skipAuth: true })`，不带 Authorization。 |
| 401 处理 | `client.ts` 内先尝试刷新令牌并重试；仍 401 则 `clearTokens()` 并派发 `auth:logout`，前端跳转登录。 |

后端网关默认端口为 **26100**（ChatKit Middleware 的 API Gateway）；生产环境以实际部署为准。
