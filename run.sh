#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "$0")/backend" && pwd)"
FRONTEND_DIR="$(cd "$(dirname "$0")/frontend" && pwd)"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
PREFERRED_BACKEND_PORT="${BACKEND_PORT:-8000}"
BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"
OLLAMA_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"

DEMO_MODE_FLAG=false
if [ "${1:-}" = "--demo" ]; then
  DEMO_MODE_FLAG=true
fi

BACKEND_PID=""
FRONTEND_PID=""
OLLAMA_PID=""

find_free_port() {
  local port="$1"
  while lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do
    port=$((port + 1))
  done
  echo "$port"
}

cleanup() {
  printf '\nStopping...\n'
  [ -n "${BACKEND_PID:-}" ] && kill "${BACKEND_PID}" 2>/dev/null || true
  [ -n "${FRONTEND_PID:-}" ] && kill "${FRONTEND_PID}" 2>/dev/null || true
  [ -n "${OLLAMA_PID:-}" ] && kill "${OLLAMA_PID}" 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM

echo "[*] Checking Ollama..."
if ! command -v ollama >/dev/null 2>&1; then
  echo "ERROR: Ollama not installed"
  exit 1
fi

# ─── --demo: one-command bootstrap ──────────────────────────────
# Isolated storage so a demo run never touches a real DB/index the user is
# also using in default mode.
DEMO_DATA_DIR="${BACKEND_DIR}/data/demo"

find_python_for_venv() {
  # Prefer a version-pinned interpreter over a bare `python3`: a Homebrew
  # `brew upgrade python@3.x` can momentarily leave the unversioned `python3`
  # symlink missing (observed live during this sprint), and never touch an
  # interpreter outside this repo either way — only used to *create* the venv.
  for candidate in python3.13 python3.11 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

ensure_backend_env_file() {
  local env_file="${BACKEND_DIR}/.env"
  if [ -f "${env_file}" ]; then
    return 0
  fi
  echo "[*] Creating backend/.env (generating APP_SECRET_KEY + DEMO_PASSWORD)..."
  cp "$(dirname "$0")/.env.example" "${env_file}"
  local secret_key demo_password
  secret_key="$(openssl rand -hex 32)"
  demo_password="$(openssl rand -hex 16)"
  # Never echo either value — write straight into the file.
  if grep -q '^APP_SECRET_KEY=' "${env_file}"; then
    sed -i.bak "s|^APP_SECRET_KEY=.*|APP_SECRET_KEY=${secret_key}|" "${env_file}"
  else
    printf 'APP_SECRET_KEY=%s\n' "${secret_key}" >>"${env_file}"
  fi
  if grep -q '^DEMO_PASSWORD=' "${env_file}"; then
    sed -i.bak "s|^DEMO_PASSWORD=.*|DEMO_PASSWORD=${demo_password}|" "${env_file}"
  else
    printf 'DEMO_PASSWORD=%s\n' "${demo_password}" >>"${env_file}"
  fi
  rm -f "${env_file}.bak"
  chmod 600 "${env_file}"
}

ensure_backend_venv() {
  if [ -x "${BACKEND_DIR}/.venv/bin/python" ]; then
    return 0
  fi
  echo "[*] Creating backend virtualenv..."
  local py
  py="$(find_python_for_venv)" || {
    echo "ERROR: no python3.13/python3.11/python3 found on PATH"
    exit 1
  }
  "${py}" -m venv "${BACKEND_DIR}/.venv"
  echo "[*] Installing backend dependencies (first run only, this can take a while)..."
  "${BACKEND_DIR}/.venv/bin/pip" install -q -r "${BACKEND_DIR}/requirements.txt"
}

ensure_frontend_deps() {
  if [ -d "${FRONTEND_DIR}/node_modules" ]; then
    return 0
  fi
  echo "[*] Installing frontend dependencies (first run only)..."
  npm ci --prefix "${FRONTEND_DIR}"
}

ensure_ollama_serving() {
  if curl -sf --max-time 2 "${OLLAMA_URL}/api/tags" >/dev/null 2>&1; then
    return 0
  fi
  echo "[*] Starting ollama serve..."
  ollama serve >/tmp/ollama-serve.log 2>&1 &
  OLLAMA_PID=$!
  local waited=0
  until curl -sf --max-time 2 "${OLLAMA_URL}/api/tags" >/dev/null 2>&1; do
    sleep 1
    waited=$((waited + 1))
    if [ "${waited}" -ge 30 ]; then
      echo "ERROR: Ollama did not become reachable within 30s"
      exit 1
    fi
  done
}

ensure_model_pulled() {
  local model="$1"
  if curl -sf --max-time 2 "${OLLAMA_URL}/api/tags" | grep -q "\"${model}\""; then
    return 0
  fi
  echo "[*] Pulling Ollama model ${model} (first run only, this can take a while)..."
  ollama pull "${model}"
}

wait_for_backend_health() {
  local url="$1"
  local waited=0
  until curl -sf --max-time 2 "${url}/health" >/dev/null 2>&1; do
    sleep 1
    waited=$((waited + 1))
    if [ "${waited}" -ge 90 ]; then
      echo "ERROR: Backend did not become healthy within 90s"
      exit 1
    fi
  done
}

if [ "${DEMO_MODE_FLAG}" = true ]; then
  ensure_backend_env_file
  ensure_backend_venv
  ensure_frontend_deps
  ensure_ollama_serving

  # Read the configured primary model out of backend/.env (fall back to the
  # documented default) without ever echoing the rest of the file.
  DEMO_MODEL="$(grep '^OLLAMA_PRIMARY_MODEL=' "${BACKEND_DIR}/.env" 2>/dev/null | cut -d= -f2- || true)"
  DEMO_MODEL="${DEMO_MODEL:-qwen3:4b-instruct}"
  ensure_model_pulled "${DEMO_MODEL}"

  mkdir -p "${DEMO_DATA_DIR}"
  export DEMO_MODE=true
  export APP_ENV=development
  export LLM_PROVIDER=ollama
  export DB_URL="sqlite+aiosqlite:///${DEMO_DATA_DIR}/truthlens.db"
  export DATA_DIR="${DEMO_DATA_DIR}"
  export UPLOAD_DIR="${DEMO_DATA_DIR}/uploads"
  export CHROMA_PERSIST_DIR="${DEMO_DATA_DIR}/chromadb"
  export BM25_INDEX_DIR="${DEMO_DATA_DIR}/bm25"

  if [ ! -f "${DEMO_DATA_DIR}/.demo_seeded" ]; then
    echo "[*] Seeding demo workspace (first run only, this can take a few minutes)..."
    (cd "${BACKEND_DIR}" && "${BACKEND_DIR}/.venv/bin/python" -m app.demo seed)
  fi
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

if [ "${DEMO_MODE_FLAG}" = true ]; then
  echo "[*] Waiting for backend to become healthy..."
  wait_for_backend_health "http://localhost:${BACKEND_PORT}"
else
  sleep 1
  if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
    echo "ERROR: Backend failed to start."
    exit 1
  fi
fi

echo "[*] Starting frontend on ${FRONTEND_PORT}..."
npm run dev --prefix "${FRONTEND_DIR}" &
FRONTEND_PID=$!

echo ""
echo "  Frontend: http://localhost:${FRONTEND_PORT}"
echo "  Backend:  http://localhost:${BACKEND_PORT}"
echo "  API docs: http://localhost:${BACKEND_PORT}/docs"
echo "  Proxy:    /api -> ${VITE_BACKEND_URL}"
if [ "${DEMO_MODE_FLAG}" = true ]; then
  echo "  Demo:     one-click Analyst/Admin login is on the login page"
  if command -v open >/dev/null 2>&1; then
    open "http://localhost:${FRONTEND_PORT}" >/dev/null 2>&1 || true
  fi
fi
echo "  Ctrl+C to stop both"
echo ""

wait
