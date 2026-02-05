# ChatKit Web: Vite build + nginx (same base as api-gateway: nginx:1.25-alpine)
# Backend is fixed: api-gateway:26100 (same Docker network). Frontend uses same-origin (no CORS).

# Stage 1: build static assets
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Same-origin: empty so browser sends requests to this nginx; nginx proxies to api-gateway
ENV VITE_API_BASE_URL=
RUN npm run build

# Stage 2: serve with nginx
FROM nginx:1.25-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
