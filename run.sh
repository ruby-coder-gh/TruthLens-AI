#!/usr/bin/env bash
set -e

BACKEND_DIR="$(cd "$(dirname "$0")/backend" && pwd)"
FRONTEND_DIR="$(cd "$(dirname "$0")/frontend" && pwd)"

cleanup() {
  echo "\nStopping..."
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

# Check deps
echo "[*] Checking Ollama..."
if ! command -v ollama &>/dev/null; then echo "ERROR: Ollama not installed"; exit 1; fi

echo "[*] Starting backend..."
source "$BACKEND_DIR/.venv/bin/activate"
cd "$BACKEND_DIR"
uvicorn app.main:app --reload --port 8000 &
BACKEND_PID=$!

echo "[*] Starting frontend..."
npm run dev --prefix "$FRONTEND_DIR" &
FRONTEND_PID=$!

echo ""
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8000"
echo "  API docs: http://localhost:8000/docs"
echo "  Ctrl+C to stop both"
echo ""

wait
