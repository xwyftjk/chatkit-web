# ChatKit Web 实现 Review

对照 [API_REFERENCE](../chatkit-middleware/docs/API_REFERENCE.md)、[产品设计](./PRODUCT_DESIGN_DRAFT.md)、[技术设计](./TECH_DESIGN.md) 对当前实现的核对与待办。

---

## 1. 对照接口文档（API_REFERENCE）

| 能力 | 接口 | 实现位置 | 结论 |
|------|------|----------|------|
| 注册 | POST /auth/register | api/auth.ts, 页面 Register | ✅ Body：email/phone_number 至少其一、password、可选 name/username/code；201 处理 |
| 登录 | POST /auth/login | api/auth.ts, 页面 Login | ✅ Body：email 或 username 或 phone_number、password；200 存 token、跳转 |
| 刷新 | POST /auth/refresh | api/client.ts refreshAccessToken | ✅ 401 时自动刷新，失败则清除并触发 auth:logout |
| 会话列表 | GET /conversation/sessions?user_id=&limit=&offset= | api/conversation.ts getSessions | ✅ |
| 会话消息 | GET /conversation/messages?session_id=&limit=&offset= | api/conversation.ts getMessages | ✅ |
| AI 发问（流式走 /events） | POST /agent（method+body.threadId+messages） | api/llm.ts postAgentRun, Workspace handleSend | ✅ 触发请求；流式结果在 useEvents 中收 |
| SSE 连接 | GET /events?sessionId= | api/events.ts createEventSource, hooks/useEvents | ✅ 按 sessionId 建连；切换会话时关闭并重连 |
| Inbox 列表 | GET /inbox/{user_id}/items | api/inbox.ts getInboxItems | ✅ |
| 文档 | POST/GET /api/documents, search, delete | api/documents.ts | ✅ 列表/上传/搜索/删除已封装；Workspace 仅展示列表 |
| 笔记 | POST/GET/PATCH/DELETE /api/notes | api/notes.ts | ✅ 列表已用；Workspace 仅展示列表 |
| 画像 | GET/PUT /api/profile/{user_id} | api/profile.ts | ✅ Me 页展示与编辑 |
| 记忆列表 | GET /api/memory?limit=&offset=&memory_type= | api/memory.ts listMemories | ✅ user_id 由网关注入 |
| 记忆搜索 | POST /api/memory/search | api/memory.ts searchMemories | ✅ Me 页搜索 + 类型筛选 |
| 记忆详情/删除 | GET/DELETE /api/memory/{memory_id} | api/memory.ts getMemoryById, deleteMemory | ✅ 删除已用；详情可后续加弹窗 |
| 时序 | POST /api/temporal/search, snapshot | api/memory.ts temporalSearch, temporalSnapshot | ⚠️ 已封装，Me 页未做时序图入口（可后续加） |

**请求头**：api/client.ts 中所有 fetch 带 X-Request-ID；鉴权请求带 Authorization: Bearer；401 时刷新或登出。✅

**差异与说明**：

- 记忆详情/删除：API 文档为 GET/DELETE `/api/memory/{memory_id}`，已按此实现（未用 /by-id/）。
- EventSource 鉴权：EventSource 无法自定义 Header，当前依赖代理同源 + Cookie 或网关对 GET 的鉴权方式；若网关仅支持 Bearer 且不提供 Cookie/query，需后端提供 GET 鉴权方案。

---

## 2. 对照产品设计（PRODUCT_DESIGN_DRAFT）

| 产品点 | 设计说明 | 实现情况 |
|--------|----------|----------|
| 登录页 /login | 账号（邮箱/用户名/手机号）+ 密码、去注册、记住我 | ✅ Login.tsx |
| 注册页 /register | 邮箱/手机号至少其一、密码≥8、可选姓名/用户名、去登录 | ✅ Register.tsx |
| 主工作台 / | 三栏：左会话列表+新会话、中聊天、右笔记+文档 | ✅ Workspace.tsx |
| 会话标题 | 后台不返回名称，由最后一条消息截断 | ⚠️ 当前用 session_id 前 8 位；需有消息后可改为最后一条内容截断 |
| 发消息 / 流式 | 输入+发送，流式展示 AI 回复 | ✅ 发问走 POST /agent，流式在 useEvents 中拼接并展示 |
| 切换会话 | 左侧选会话，中间切换内容；SSE 按 sessionId 重连 | ✅ setCurrentSessionId 后 useEvents(sessionId) 自动重连 |
| 顶栏 | 消息、我的、退出登录 | ✅ Layout：消息链到 /inbox，我的链到 /me，退出调用 logout |
| Inbox /inbox | 消息列表分页 | ✅ Inbox.tsx 拉取 /inbox/{user_id}/items |
| 个人中心 /me | 上画像、下记忆，无 Tab；退出登录 | ✅ Me.tsx：画像块+记忆列表；退出在 Layout |
| 画像 | GET/PUT，编辑/保存 | ✅ 展示 + 编辑入口（保存示例为 risk_tolerance） |
| 记忆 | 列表、语义搜索、类型筛选(4 类)、删除 | ✅ 四种类型标签；删除二次确认（confirm） |
| 笔记/文档 | 右侧仅展示列表；新建/编辑/删除为后续 | ⚠️ 当前只读列表；CRUD 可后续在右侧或独立页完成 |

**未实现 / 待增强**：

- 会话标题：从「最后一条消息」截断（需在选中会话拉完消息后更新标题）。
- 笔记/文档：右侧增加新建、编辑、删除（调用现有 api/notes、api/documents）。
- 时序图：Me 页增加「时序图」入口，调用 temporalSearch / temporalSnapshot 并展示。
- 抽屉折叠：左/右栏折叠为产品要求；当前为固定宽度，可加折叠按钮与状态。

---

## 3. 对照技术设计（TECH_DESIGN）

| 技术点 | 设计说明 | 实现情况 |
|--------|----------|----------|
| 技术栈 | React 18、Vite、TS、React Router、Zustand、Tailwind、React Hook Form | ✅ package.json 与结构一致 |
| API 层 | 统一 client（BaseURL、X-Request-ID、Authorization、401 刷新）、按模块拆分 | ✅ api/client.ts + auth/conversation/llm/documents/notes/profile/memory/inbox/events |
| 状态层 | 默认内存；仅登录态可选持久化 | ✅ auth 存 token 可选 localStorage/sessionStorage；conversation 仅内存 |
| 视图层 | 页面调 api 与 store | ✅ |
| SSE | 只复用一条连接，按 sessionId；切换会话关旧连、用新 sessionId 建新连 | ✅ useEvents(sessionId)，useEffect 依赖 sessionId，清理时 close |
| 发问 | POST 触发，流式经 /events 收 | ✅ postAgentRun + useEvents 内解析 message/content/done |
| 目录结构 | api/、stores/、pages/、components/、hooks/、routes/ | ✅ |
| 路由与鉴权 | /login、/register、/、/me、/inbox；ProtectedRoute 无 token 跳登录 | ✅ App.tsx + ProtectedRoute.tsx |
| 登出 | 清除本地令牌并跳转 /login | ✅ auth.logout + Layout 退出按钮 |

**差异与说明**：

- 技术设计提到「发问用 POST /llm/chat/completions 或 /agent」：当前实现用 POST /agent（method+body.threadId+messages），与「流式走 /events」一致；若后端仅提供 /llm/chat/completions，可再加一层封装或切换入口。
- EventSource 鉴权：同上，依赖网关对 GET 的支持。

---

## 4. 小结与建议

- **接口文档**：已按文档实现注册、登录、刷新、会话、消息、Agent、SSE、Inbox、文档、笔记、画像、记忆列表/搜索/删除；时序接口已封装，待在 Me 页接时序图。
- **产品设计**：登录/注册、主工作台三栏、个人中心、Inbox、退出登录已实现；会话标题、笔记/文档 CRUD、时序图、侧栏折叠为可迭代项。
- **技术设计**：分层、SSE 单连接与切换会话重连、状态仅登录态持久化、路由与鉴权均符合。

**建议下一步**：

1. 会话标题：在拉取当前会话 messages 后，用最后一条 content 截断作为左侧该项标题。
2. 笔记/文档：在右侧或 Me 旁增加新建/编辑/删除（调用现有 API）。
3. Me 页：增加「时序图」按钮，调用 temporalSearch/temporalSnapshot 并展示结果。
4. 左/右栏：增加折叠状态与按钮，符合产品「抽屉式」描述。
5. 本地运行：若 `npm install` 报权限错误，可修复 npm 缓存权限后再次安装并执行 `npm run dev` 验证。
