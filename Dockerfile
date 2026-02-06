# ChatKit Web: Vite build + nginx + LongMemEval test server
# Frontend: nginx serving static files
# Backend: Bun running LongMemEval test server

# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV VITE_API_BASE_URL=
RUN npm run build

# Stage 2: Final image with nginx + bun
FROM oven/bun:1.1-alpine

# Install nginx and supervisor
RUN apk add --no-cache nginx supervisor

# Copy frontend build
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/http.d/default.conf

# Copy LongMemEval test server
WORKDIR /app/longmemeval
COPY test/longmemeval-server/ .

# Install dependencies
RUN cd runner && bun install

# Create reports directory
RUN mkdir -p reports

# Create supervisor config
RUN mkdir -p /etc/supervisor.d
RUN echo "[supervisord]" > /etc/supervisor.d/supervisord.ini && \
    echo "nodaemon=true" >> /etc/supervisor.d/supervisord.ini && \
    echo "logfile=/dev/null" >> /etc/supervisor.d/supervisord.ini && \
    echo "logfile_maxbytes=0" >> /etc/supervisor.d/supervisord.ini && \
    echo "" >> /etc/supervisor.d/supervisord.ini && \
    echo "[program:nginx]" >> /etc/supervisor.d/supervisord.ini && \
    echo "command=nginx -g 'daemon off;'" >> /etc/supervisor.d/supervisord.ini && \
    echo "autostart=true" >> /etc/supervisor.d/supervisord.ini && \
    echo "autorestart=true" >> /etc/supervisor.d/supervisord.ini && \
    echo "stdout_logfile=/dev/stdout" >> /etc/supervisor.d/supervisord.ini && \
    echo "stdout_logfile_maxbytes=0" >> /etc/supervisor.d/supervisord.ini && \
    echo "stderr_logfile=/dev/stderr" >> /etc/supervisor.d/supervisord.ini && \
    echo "stderr_logfile_maxbytes=0" >> /etc/supervisor.d/supervisord.ini && \
    echo "" >> /etc/supervisor.d/supervisord.ini && \
    echo "[program:longmemeval]" >> /etc/supervisor.d/supervisord.ini && \
    echo "command=bun run server.ts" >> /etc/supervisor.d/supervisord.ini && \
    echo "directory=/app/longmemeval" >> /etc/supervisor.d/supervisord.ini && \
    echo "autostart=true" >> /etc/supervisor.d/supervisord.ini && \
    echo "autorestart=true" >> /etc/supervisor.d/supervisord.ini && \
    echo "stdout_logfile=/dev/stdout" >> /etc/supervisor.d/supervisord.ini && \
    echo "stdout_logfile_maxbytes=0" >> /etc/supervisor.d/supervisord.ini && \
    echo "stderr_logfile=/dev/stderr" >> /etc/supervisor.d/supervisord.ini && \
    echo "stderr_logfile_maxbytes=0" >> /etc/supervisor.d/supervisord.ini

# Remove default nginx config
RUN rm -f /etc/nginx/http.d/default.conf.bak 2>/dev/null || true

EXPOSE 80

CMD ["supervisord", "-c", "/etc/supervisor.d/supervisord.ini"]
