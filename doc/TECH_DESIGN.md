# ChatKit Web 技术设计

> 基于 [产品设计初稿](./PRODUCT_DESIGN_DRAFT.md) 与 [ChatKit Middleware API 文档](../chatkit-middleware/docs/API_REFERENCE.md) 的前端技术设计，供实现与评审。

---

## 1. 概述与依据

- **产品依据**：[PRODUCT_DESIGN_DRAFT.md](./PRODUCT_DESIGN_DRAFT.md)（登录/注册、主工作台三栏、个人中心、Inbox、记忆与画像）。
- **接口依据**：所有能力经 API Gateway（默认 `http://localhost:26100`），请求头需 `X-Request-ID`，鉴权接口外需 `Authorization: Bearer <access_token>`。
- **技术设计目标**：技术栈选型、SSE 流实现、分层与目录、前端数据存储边界，便于落地与维护。

---

## 2. 前端技术栈选型

### 2.1 推荐方案（MVP）

| 类别 | 选型 | 说明 |
|------|------|------|
| **框架** | **React 18+** | 生态成熟、与流式 UI 和复杂状态配合好；若团队以 Vue 为主可改为 Vue 3。 |
| **构建** | **Vite 5** | 开发快、与 React/Vue 官方模板一致，生产构建基于 Rollup。 |
| **语言** | **TypeScript** | 与后端契约、类型安全、可复用 API 类型定义（若从 OpenAPI 生成）。 |
| **路由** | **React Router 6**（或 Vue Router 4） | 支持 /login、/register、/、/me、/inbox 等，路由守卫做鉴权跳转。 |
| **状态** | **React：Zustand 或 React Context + useReducer**（Vue：Pinia） | 全局：用户/令牌、当前会话；局部：表单、列表分页。避免过度抽象，MVP 可不引入 Redux。 |
| **请求** | **fetch + 封装** | 统一 Base URL、注入 `X-Request-ID` 与 `Authorization`、401 时刷新令牌或跳转登录。流式用原生 `fetch` + `ReadableStream`（见 §3）。 |
| **样式** | **CSS Modules 或 Tailwind CSS** | 与现有产品设计一致即可；Tailwind 利于快速实现三栏、表单、时间轴。 |
| **表单** | **React Hook Form**（或 Vue 用 v-model + 轻量校验） | 登录/注册/画像编辑，校验规则与 API 文档 400 信息对齐。 |
| **环境** | **.env** | `VITE_API_BASE_URL`（默认 `http://localhost:26100`），构建时注入。 |

### 2.2 可选替代

- **框架**：Vue 3 + Composition API，等价能力均可实现。
- **状态**：若后续复杂度高，可再引入 Redux Toolkit 或 Pinia 模块化。
- **请求**：若需统一拦截与类型生成，可加 axios；流式仍建议用 fetch + ReadableStream 以便细粒度控制。

### 2.3 不推荐

- MVP 阶段不引入 GraphQL、不引入复杂 BFF 层（所有请求直连 API Gateway）。
- 不引入后端未要求的额外持久化（见 §5 数据存储）。

---

## 3. SSE 流实现方案

根据**接口文档**（API_REFERENCE §4），目前**只复用一条连接**：客户端**只建立一条** `GET /events?sessionId=...` 长连接，**(1) AI 问答的流式回复** 与 **(2) 服务端主动推送（如 Inbox 新消息）** 均在该连接上推送。无需为 AI 流与推送各建一条流；每个 session 对应一条 SSE 连接。

### 3.1 统一 SSE 连接（唯一长连接）

- **接口**：`GET /events?sessionId=...`，`Content-Type: text/event-stream`，长连接；服务端定期心跳保活。
- **后台行为（与 sessionId 绑定）**：后台**会把 sessionId 与 SSE 连接一一绑定**（`ag-ui-server`：`connection.ts` 中 `connections.set(sessionId, connection)`，`events.ts` 中 `register(sessionId, reply, userId, deviceId)`）。**一条连接只对应一个 sessionId**；AI 事件通过 `sendEvent(sessionId, event)` 发到该 session 的连接，Inbox 推送通过 `sendEventToUser(userId, event)` 发到该用户下所有已注册的 session 连接。
- **切换会话时一条连接能否继续用**：**不能**。当前连接只接收**当前 sessionId** 的事件；若用户在前端切换到另一会话（另一 sessionId），后端仍只会把新会话的 AI 流发到「新 sessionId 对应的连接」，而不会发到旧会话的那条连接。因此**切换会话时前端必须**：先关闭当前 EventSource，再用**新 sessionId** 重新建连（`GET /events?sessionId=<新会话 id>`），否则新会话的 AI 流收不到（后端会走「该 session 无连接」分支，可能用 POST 响应体作为流，与「只复用一条连接」的用法不一致）。
- **实现方式**：使用 **EventSource**（GET、带查询参数、`withCredentials: true`）。用户进入主工作台后为**当前选中会话**建立一条连接；**切换会话时关闭旧连接、用新 sessionId 建新连接**，保证「一条连接 = 当前会话」。
- **流程**：
  1. 进入主工作台后，用**当前会话的 session_id**（新会话可为新生成的 UUID）建立 `EventSource(`${API_BASE}/events?sessionId=${sessionId}`, { withCredentials: true })`。
  2. 请求头：EventSource 无法自定义 Header，鉴权依赖网关对同源 Cookie 或 URL 参数（若网关要求 Bearer 在 Header，需确认是否支持 Cookie/query 传 token）。
  3. **事件分发**：`es.onmessage`（或按 `event.type`）根据 `data.type` 或事件类型区分处理：
     - **AI 流式**：如 `message`、content/done 等，解析后追加到当前回复内容并更新 UI。
     - **推送**：如 `inbox.new`，刷新 Inbox 列表或红点。
  4. **切换会话**：关闭当前 EventSource（`es.close()`），用新 sessionId 新建 EventSource。
  5. `es.onerror`：断线后按策略重连（指数退避、最大重试，**同一 sessionId**），或降级为轮询 `GET /inbox/{user_id}/items`。

```ts
// 伪代码：一条连接，按事件类型分发
const sessionId = currentSessionId; // 与当前会话一致
const es = new EventSource(`${API_BASE}/events?sessionId=${sessionId}`, { withCredentials: true });
es.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data.type === 'inbox.new') {
    refreshInboxOrBadge();
  } else if (data.type === 'message' || data.event === 'content') {
    appendAiChunk(data); // AI 流式片段，更新当前回复 UI
  }
  // 其他 type 按后端约定处理
};
es.onerror = () => { /* 重连或降级轮询 */ };
```

### 3.2 AI 发问的触发（流式输出走同一条 /events）

- **发问**：用户发送消息时，前端调用 **POST** 接口提交请求（如 `POST /llm/chat/completions` 或 Agent 流式接口如 `POST /agent`，具体以 API 文档为准），Body 含当前会话上下文（messages、sessionId 等）。
- **收流**：流式**输出**不由该 POST 的响应体返回，而是由服务端通过**已建立的** `/events` 连接推送到客户端；前端在 §3.1 的 EventSource 回调里解析 AI 相关事件并更新 UI。
- **未先建 /events 时的降级**：接口文档说明，若客户端未先连 `GET /events`，部分接口（如 `POST /agent`）的**响应体**本身可能是 SSE 流，服务端会将该响应当作该 session 的唯一连接并参与后续推送。此时前端可降级为对该 POST 的 `response.body` 做 ReadableStream 解析；但**推荐**进入工作台后先建 `/events`，再发问，以统一只复用一条连接。

### 3.3 小结

| 场景 | 接口/连接 | 实现 | 是否复用同一条连接 |
|------|-----------|------|--------------------|
| AI 流式回复 | 经 `GET /events` 推送 | EventSource 上按事件类型解析 | **是**（与推送共用一条连接） |
| Inbox 等推送 | 同左 | 同左 | **是** |
| 用户发问 | POST（如 /llm/chat/completions 或 /agent） | fetch，仅触发请求，不消费响应体流 | 不建新流，流式结果从 /events 收 |

**切换会话**：后台一条 SSE 连接只绑定一个 sessionId；切换会话时前端需**关闭当前 EventSource 并用新 sessionId 重新建连**，否则新会话的 AI 流无法通过该连接收到。

---

## 4. 分层与目录结构

### 4.1 是否采用分层

**建议采用轻量分层**，便于维护与测试，又不增加 MVP 复杂度。

- **API 层**：封装所有与后端的 HTTP/SSE 调用，统一 Base URL、请求头、401 处理（刷新 token 或跳转登录）。不在此层写业务逻辑。
- **状态层**：用户/令牌、当前会话/消息列表、个人中心数据等；可集中在若干 store（Zustand/Pinia）或 Context，按模块划分。
- **视图层**：页面与组件，只通过状态与 API 层交互，不直接写 fetch URL。

这样带来的好处：契约变更时改 API 层；状态结构清晰；视图可替换（如先做简单列表再升级为时间轴）。

### 4.2 推荐目录结构（React + Vite 示例）

```
chatkit-web/
├── doc/                    # 产品设计、技术设计（本目录）
├── public/
├── src/
│   ├── api/                # API 层
│   │   ├── client.ts       # fetch 封装、X-Request-ID、Authorization、401 处理
│   │   ├── auth.ts         # login, register, refresh
│   │   ├── conversation.ts # sessions, messages
│   │   ├── llm.ts          # chat completions（含流式）
│   │   ├── documents.ts
│   │   ├── notes.ts
│   │   ├── profile.ts
│   │   ├── memory.ts
│   │   └── events.ts       # EventSource 封装（可选）
│   ├── stores/             # 状态层（Zustand 或 Context）
│   │   ├── auth.ts
│   │   ├── conversation.ts
│   │   └── ...
│   ├── routes/             # 路由配置与守卫
│   ├── pages/               # 页面级组件
│   │   ├── Login.tsx
│   │   ├── Register.tsx
│   │   ├── Workspace.tsx    # 主工作台
│   │   ├── Inbox.tsx
│   │   └── Me.tsx           # 个人中心
│   ├── components/          # 可复用组件（表单、列表、时间轴等）
│   ├── hooks/               # 如 useAuth, useStreamCompletions
│   ├── App.tsx
│   └── main.tsx
├── .env
├── package.json
├── tsconfig.json
└── vite.config.ts
```

- **API 层**：`api/client.ts` 内统一设置 `VITE_API_BASE_URL`、请求头、响应错误与 401 处理；各 `api/*.ts` 只负责入参/出参与调用 client。
- **状态层**：如 `stores/auth.ts` 存 token、user_id、logout；`stores/conversation.ts` 存当前 session_id、消息列表等。**默认仅为内存（临时）**：关闭网页或刷新后清空；仅登录态（token、user_id）可按需持久化到 sessionStorage/localStorage（见 §5 数据存储），其余会话/消息/列表等不落盘，重新打开页面后从 API 拉取。
- **视图层**：页面从 store 读数据、调 api 层方法；流式回复可在 `hooks/useStreamCompletions` 中封装，内部调 `api/llm.ts` 的流式方法并更新 store 或局部 state。

### 4.3 路由与鉴权

- 路由表：`/login`、`/register`、`/`（主工作台）、`/me`、`/inbox`。
- 鉴权守卫：除 `/login`、`/register` 外，访问其他路径时若本地无有效 token（或 refresh 失败），重定向到 `/login`；登录成功后跳转 `/` 或原先目标路径。

---

## 5. 数据存储

### 5.1 原则

- **业务数据以服务端为准**：会话、消息、文档、笔记、画像、记忆等均来自 API，前端不替代后端做持久化。
- **前端仅做「与体验相关的必要存储」**：登录态、可选缓存，且不视为唯一数据源。

### 5.2 建议存储方式

| 内容 | 存储位置 | 说明 |
|------|----------|------|
| **access_token / refresh_token** | **内存 + 可选 sessionStorage 或 localStorage** | 内存必选；持久化可选（如「记住我」用 localStorage，否则 sessionStorage）。页面刷新后可用 refresh_token 换新 access_token。 |
| **user_id** | 随 token 一起存或从 JWT 解析 | 用于请求参数或展示。 |
| **当前会话、当前消息列表** | **内存（如 Zustand/Context）** | 切换会话时重新拉取；刷新后可从会话列表再进。不落盘。 |
| **会话列表** | **内存** | 进入工作台时拉取；可做短期缓存（如 5 分钟内复用），但以服务端为准。 |
| **文档/笔记/画像/记忆** | **内存** | 按页按需拉取，不建本地库。 |
| **未读/红点** | **内存或短期 sessionStorage** | 若接口未返回未读数，可用「上次查看时间」等推断，仅前端展示用。 |

### 5.3 不做的存储

- **不建 IndexedDB/SQLite 等业务库**：不把会话、消息、文档等做本地持久化库，避免与后端不一致。
- **不把流式回复先写本地再上传**：流式结束后若后端有「会话落库」接口，再按契约同步；前端仅维护当前会话内的消息列表状态。

### 5.4 小结

- **涉及的数据存储**：仅 **登录态（token + 可选 user_id）** 及 **可选短期缓存（会话列表等）**；不涉及业务数据库或复杂离线库。
- 若后续做 PWA/离线，再单独设计「仅缓存静态资源或只读数据」的策略。

---

## 6. 其他

### 6.1 请求头与鉴权

- 所有请求（除登录/注册）：`X-Request-ID: <uuid>`，`Authorization: Bearer <access_token>`。
- 401：先尝试 `POST /auth/refresh` 用 refresh_token 换新 token，再重试原请求；若 refresh 失败或无 refresh_token，清除本地令牌并跳转 `/login`。

### 6.2 错误与用户提示

- 4xx/5xx：统一解析后端 `message` 或 `error`，在页内或 Toast 展示；不暴露堆栈。
- 网络错误：提示「网络异常，请重试」并可重试。

### 6.3 环境与部署

- 开发：`.env.development` 中 `VITE_API_BASE_URL=http://localhost:26100`（或实际网关地址）。
- 生产：构建时注入同一变量，指向生产 API Gateway。前端为静态资源，可部署至任意 CDN/静态托管；若与网关同域可减少 CORS 配置。

---

## 7. 文档索引

- **产品设计**：[PRODUCT_DESIGN_DRAFT.md](./PRODUCT_DESIGN_DRAFT.md)
- **API 契约**：[ChatKit Middleware - API_REFERENCE.md](../chatkit-middleware/docs/API_REFERENCE.md)
- **本技术设计**：`chatkit-web/doc/TECH_DESIGN.md`

---

*技术设计初稿，可根据实现反馈修订。*
