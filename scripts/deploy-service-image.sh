#!/bin/bash
#
# Build and deploy chatkit-web image to a server (no cross-repo; runs from this repo).
#
# Usage:
#   ./scripts/deploy-service-image.sh [SERVER]
#
# Examples:
#   ./scripts/deploy-service-image.sh ubuntu@dev
#   ./scripts/deploy-service-image.sh                    # SERVER=ubuntu@dev
#
# Parameters:
#   SERVER  - SSH target (default: ubuntu@dev)
#
# Optional env:
#   REGISTRY     - If set: build -> push -> ssh "docker pull && restart". If unset: build -> save -> scp -> load -> restart
#   (chatkit-web is not managed by fleet; we only load image and restart container.)
#   VERSION      - Image tag version (default: 1.0.26). Used for push and for server-side image tag.
#   IMAGE_TAG    - Server image tag (default: chatkit-web:latest when REGISTRY unset)
#   SKIP_BUILD   - Set to 1 to skip build (use existing local image)
#   SKIP_PUSH    - Set to 1 to skip push (only when REGISTRY is set)
#   SKIP_SAVE    - Set to 1 to skip save (when not using REGISTRY; use existing tar)
#   SKIP_UPLOAD  - Set to 1 to skip scp (when not using REGISTRY)
#   PLATFORM     - Docker build platform (default: linux/amd64 for server deploy)
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTAINER="chatkit-web"
SERVER="${1:-ubuntu@dev}"
REPORTS_DIR="/opt/chatkit-web/reports"

VERSION="${VERSION:-1.0.26}"
REGISTRY="${REGISTRY:-}"
PLATFORM="${PLATFORM:-linux/amd64}"

LOCAL_IMAGE="chatkit-web:latest"
REGISTRY_IMAGE="${REGISTRY}/${CONTAINER}:${VERSION}"
IMAGE_TAG="${IMAGE_TAG:-chatkit-web:latest}"

TAR_PATH="/tmp/${CONTAINER}.tar"
REMOTE_TAR="/tmp/${CONTAINER}.tar"

echo "=== Build & Deploy chatkit-web to ${SERVER} ==="
echo "  SERVER=$SERVER"
echo "  IMAGE_TAG=$IMAGE_TAG"
if [[ -n "$REGISTRY" ]]; then
  echo "  REGISTRY=$REGISTRY (will push then pull on server)"
else
  echo "  REGISTRY=(unset) (will save/scp/load)"
fi
echo ""

cd "$ROOT_DIR"

# ----- 1. Build -----
if [[ -z "${SKIP_BUILD:-}" ]]; then
  echo "[1] Building chatkit-web (platform=${PLATFORM}) ..."
  docker build --platform "$PLATFORM" \
    -f "$ROOT_DIR/Dockerfile" \
    -t "$LOCAL_IMAGE" \
    "$ROOT_DIR"
  echo "      Built $LOCAL_IMAGE"
else
  echo "[1] Skip build (SKIP_BUILD=1). Using existing $LOCAL_IMAGE"
  if ! docker image inspect "$LOCAL_IMAGE" >/dev/null 2>&1; then
    echo "Error: Image $LOCAL_IMAGE not found. Remove SKIP_BUILD or build first."
    exit 1
  fi
fi

if [[ -n "$REGISTRY" ]]; then
  # ----- 2a. Tag for registry -----
  echo "[2] Tagging for registry $REGISTRY_IMAGE ..."
  docker tag "$LOCAL_IMAGE" "$REGISTRY_IMAGE"
  docker tag "$LOCAL_IMAGE" "${REGISTRY}/${CONTAINER}:latest" || true

  # ----- 3a. Push -----
  if [[ -z "${SKIP_PUSH:-}" ]]; then
    echo "[3] Pushing $REGISTRY_IMAGE ..."
    docker push "$REGISTRY_IMAGE"
    docker push "${REGISTRY}/${CONTAINER}:latest" 2>/dev/null || true
  else
    echo "[3] Skip push (SKIP_PUSH=1)."
  fi

  # ----- 4a. On server: pull & recreate (chatkit-web not in fleet) -----
  echo "[4] On server: pull image and recreate container ..."
  ssh "$SERVER" "sudo docker pull $REGISTRY_IMAGE && sudo docker tag $REGISTRY_IMAGE $IMAGE_TAG && sudo mkdir -p $REPORTS_DIR && sudo docker stop ${CONTAINER} 2>/dev/null; sudo docker rm ${CONTAINER} 2>/dev/null; sudo docker run -d --name ${CONTAINER} --network chatkit-network -p 5245:80 -v ${REPORTS_DIR}:/app/longmemeval/reports --restart unless-stopped $IMAGE_TAG"
else
  # ----- 2b. Save -----
  if [[ -z "${SKIP_SAVE:-}" ]]; then
    echo "[2] Saving image to $TAR_PATH ..."
    docker save "$LOCAL_IMAGE" -o "$TAR_PATH"
    ls -la "$TAR_PATH"
  else
    echo "[2] Skip save (SKIP_SAVE=1). Using existing $TAR_PATH"
    [[ -f "$TAR_PATH" ]] || { echo "Error: $TAR_PATH not found."; exit 1; }
  fi

  # ----- 3b. Upload -----
  if [[ -z "${SKIP_UPLOAD:-}" ]]; then
    echo "[3] Uploading to $SERVER:$REMOTE_TAR ..."
    scp "$TAR_PATH" "$SERVER:$REMOTE_TAR"
  else
    echo "[3] Skip upload (SKIP_UPLOAD=1)."
  fi

  # ----- 4b. On server: load, tag, recreate (chatkit-web not in fleet) -----
  echo "[4] On server: load image and tag as $IMAGE_TAG ..."
  ssh "$SERVER" "sudo docker load -i $REMOTE_TAR && sudo docker tag $LOCAL_IMAGE $IMAGE_TAG"

  echo "[5] On server: recreate container ${CONTAINER} ..."
  ssh "$SERVER" "sudo mkdir -p $REPORTS_DIR && sudo docker stop ${CONTAINER} 2>/dev/null; sudo docker rm ${CONTAINER} 2>/dev/null; sudo docker run -d --name ${CONTAINER} --network chatkit-network -p 5245:80 -v ${REPORTS_DIR}:/app/longmemeval/reports --restart unless-stopped $IMAGE_TAG"
fi

echo ""
echo "Done. chatkit-web on ${SERVER} is now running from the deployed image."
