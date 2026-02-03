# ChatKit Web

基于 [产品设计](./doc/PRODUCT_DESIGN_DRAFT.md) 与 [技术设计](./doc/TECH_DESIGN.md) 的前端应用，对接 ChatKit Middleware API（默认 `http://localhost:26100`）。

## 技术栈

- React 18、TypeScript、Vite 5
- React Router 6、Zustand、React Hook Form
- Tailwind CSS
- fetch + EventSource（SSE 一条连接 / sessionId）

## 开发

```bash
npm install
npm run dev
```

开发时通过 Vite 代理访问后端：`/auth`、`/conversation`、`/llm`、`/api`、`/inbox`、`/events`、`/agent` 会转发到 `VITE_API_BASE_URL`（默认 `http://localhost:26100`）。若后端在不同端口，可设置 `.env`：

```
VITE_API_BASE_URL=http://localhost:26100
```

## 构建

```bash
npm run build
npm run preview
```

## 路由

| 路径       | 说明           | 鉴权   |
|------------|----------------|--------|
| /login     | 登录           | 否     |
| /register  | 注册           | 否     |
| /          | 主工作台三栏   | 是     |
| /inbox     | 消息通知       | 是     |
| /me        | 个人中心       | 是     |

## 文档

- [产品设计初稿](./doc/PRODUCT_DESIGN_DRAFT.md)
- [技术设计](./doc/TECH_DESIGN.md)
- [API 文档](../chatkit-middleware/docs/API_REFERENCE.md)（chatkit-web 与 chatkit-middleware 平级时）
