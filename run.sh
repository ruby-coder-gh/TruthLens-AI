#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "$0")/backend" && pwd)"
FRONTEND_DIR="$(cd "$(dirname "$0")/frontend" && pwd)"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
PREFERRED_BACKEND_PORT="${BACKEND_PORT:-8000}"
BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"

BACKEND_PID=""
FRONTEND_PID=""

find_free_port() {
  local port="$1"
  while lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do
    port=$((port + 1))
  done
  echo "$port"
}

cleanup() {
  echo "\nStopping..."
  [ -n "${BACKEND_PID:-}" ] && kill "${BACKEND_PID}" 2>/dev/null || true
  [ -n "${FRONTEND_PID:-}" ] && kill "${FRONTEND_PID}" 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM

echo "[*] Checking Ollama..."
if ! command -v ollama >/dev/null 2>&1; then
  echo "ERROR: Ollama not installed"
  exit 1
fi

BACKEND_PORT="$(find_free_port "${PREFERRED_BACKEND_PORT}")"
if [ "${BACKEND_PORT}" != "${PREFERRED_BACKEND_PORT}" ]; then
  echo "[!] Port ${PREFERRED_BACKEND_PORT} is busy. Using backend port ${BACKEND_PORT}."
fi

export VITE_BACKEND_URL="http://localhost:${BACKEND_PORT}"
export VITE_PORT="${FRONTEND_PORT}"

echo "[*] Starting backend on ${BACKEND_PORT}..."
source "${BACKEND_DIR}/.venv/bin/activate"
cd "${BACKEND_DIR}"
uvicorn app.main:app --reload --host "${BACKEND_HOST}" --port "${BACKEND_PORT}" &
BACKEND_PID=$!

sleep 1
if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
  echo "ERROR: Backend failed to start."
  exit 1
fi

echo "[*] Starting frontend on ${FRONTEND_PORT}..."
npm run dev --prefix "${FRONTEND_DIR}" &
FRONTEND_PID=$!

echo ""
echo "  Frontend: http://localhost:${FRONTEND_PORT}"
echo "  Backend:  http://localhost:${BACKEND_PORT}"
echo "  API docs: http://localhost:${BACKEND_PORT}/docs"
echo "  Proxy:    /api -> ${VITE_BACKEND_URL}"
echo "  Ctrl+C to stop both"
echo ""

wait
