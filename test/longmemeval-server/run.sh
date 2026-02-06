#!/bin/bash
# LongMemEval Server Startup Script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR"

# Install runner dependencies if needed
if [ ! -d "runner/node_modules" ]; then
    echo "Installing runner dependencies..."
    cd runner && bun install && cd ..
fi

# Auto-detect diffusion worker URL if running in Docker
if [ -z "$MEMORY_DIFFUSION_WORKER_URL" ]; then
    DIFFUSION_IP=$(docker inspect chatkit-memory-diffusion-worker --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null)
    if [ -n "$DIFFUSION_IP" ]; then
        export MEMORY_DIFFUSION_WORKER_URL="http://${DIFFUSION_IP}:26407"
        echo "Auto-detected diffusion worker: $MEMORY_DIFFUSION_WORKER_URL"
    fi
fi

# Start the server
echo "Starting LongMemEval Server..."
bun run server.ts "$@"
