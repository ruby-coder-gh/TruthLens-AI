"""Application configuration via pydantic-settings."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ─── App ───────────────────────────────────
    APP_NAME: str = "VeritasRAG"
    APP_VERSION: str = "0.1.0"
    APP_ENV: Literal["development", "production"] = "development"
    APP_SECRET_KEY: str
    APP_CORS_ORIGINS: str = "http://localhost:5173,http://localhost:4000"

    # ─── Server ────────────────────────────────
    SERVER_HOST: str = "0.0.0.0"
    SERVER_PORT: int = 8000
    SERVER_WORKERS: int = 1
    SERVER_MAX_UPLOAD_SIZE: int = 52_428_800  # 50 MB

    # ─── Database ──────────────────────────────
    DB_URL: str = "sqlite+aiosqlite:///./data/truthlens.db"
    DB_ECHO: bool = False

    # ─── ChromaDB ──────────────────────────────
    CHROMA_PERSIST_DIR: str = "./data/chromadb"
    CHROMA_COLLECTION_PREFIX: str = "ws_"

    # ─── Ollama ────────────────────────────────
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_PRIMARY_MODEL: str = "qwen3:4b"
    OLLAMA_FALLBACK_MODEL: str = "qwen3:4b"
    OLLAMA_EMBED_MODEL: str = "nomic-embed-text"
    OLLAMA_RERANK_MODEL: str = "nomic-embed-text"
    OLLAMA_VISION_MODEL: str = "llava:7b"
    OLLAMA_TIMEOUT: int = 120
    OLLAMA_MAX_TOKENS: int = 2048
    OLLAMA_TEMPERATURE: float = 0.3
    OLLAMA_TOP_P: float = 0.9
    OLLAMA_NUM_CTX: int = 4096

    # ─── LLM Provider (API fallback) ──────────
    LLM_PROVIDER: str = "auto"  # auto, api, ollama
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_TIMEOUT: int = 60

    # ─── Sentence Transformers ─────────────────
    EMBED_MODEL_NAME: str = "BAAI/bge-base-en-v1.5"
    EMBED_DIMENSION: int = 768
    EMBED_DEVICE: str = "cpu"
    RERANK_MODEL_NAME: str = "BAAI/bge-reranker-v2-m3"

    # ─── Retrieval ─────────────────────────────
    RETRIEVAL_TOP_K: int = 10
    RETRIEVAL_RERANK_K: int = 5
    RETRIEVAL_BM25_WEIGHT: float = 0.3
    RETRIEVAL_VECTOR_WEIGHT: float = 0.7
    RETRIEVAL_RERANK_WEIGHT: float = 0.6
    RETRIEVAL_MIN_SCORE: float = 0.3

    # ─── Evidence Sufficiency Gate ─────────────
    # Abstain instead of generating when retrieval is too thin. The floor is on
    # the cross-encoder rerank_score: BAAI/bge-reranker-v2-m3 has num_labels==1,
    # so sentence-transformers applies a Sigmoid and the score is a calibrated
    # relevance probability in (0, 1). 0.35 sits below the model's own 0.5
    # decision boundary (marginal matches still get answered) and far above the
    # near-zero cluster of irrelevant chunks.
    SUFFICIENCY_GATE_ENABLED: bool = True
    SUFFICIENCY_MIN_RERANK_SCORE: float = 0.35
    SUFFICIENCY_MIN_SUPPORTING: int = 1

    # ─── Guardrail ────────────────────────────
    GUARDRAIL_THRESHOLD: float = 0.7
    GUARDRAIL_MAX_RETRIES: int = 3
    GUARDRAIL_NLI_MODEL: str = "cross-encoder/nli-deberta-v3-base"

    # ─── Chunking ─────────────────────────────
    CHUNK_SIZE: int = 512
    CHUNK_OVERLAP: int = 64
    CHUNK_SEPARATORS: list[str] = ["\n\n", "\n", ".", "!", "?", ",", " ", ""]

    # ─── Ingest-time Prompt-Injection Quarantine (F7a) ───────
    # detect_injection() was written for short, adversarial user queries; run
    # unfiltered over ordinary document prose it over-triggers (see
    # app/ingestion/quarantine.py INGEST_EXCLUDED_PATTERNS). Only patterns at
    # or above QUARANTINE_MIN_SEVERITY, and not in that exclusion set, ever
    # quarantine a chunk.
    QUARANTINE_ENABLED: bool = True
    QUARANTINE_MIN_SEVERITY: str = "high"

    # ─── Query Rewriting ──────────────────────
    REWRITE_ENABLED: bool = True
    REWRITE_TEMPERATURE: float = 0.2
    REWRITE_MAX_TOKENS: int = 256

    # ─── Query Cache ─────────────────────────
    QUERY_CACHE_ENABLED: bool = True
    QUERY_CACHE_TTL_SECONDS: int = 3600

    # ─── Trust Score ──────────────────────────
    TRUST_RETRIEVAL_WEIGHT: float = 0.3
    TRUST_FAITHFULNESS_WEIGHT: float = 0.4
    TRUST_RELEVANCE_WEIGHT: float = 0.2
    TRUST_SOURCE_WEIGHT: float = 0.1

    # ─── Human Review Queue ───────────────────
    REVIEW_QUEUE_TRUST_THRESHOLD: float = 0.5
    QUERY_PIN_LIMIT: int = 20

    # ─── Usage & Cost Reporting ────────────────
    # JSON map of model name -> {"input_per_1k": float, "output_per_1k": float}.
    # Models absent from the map (e.g. local Ollama models) cost $0.
    MODEL_PRICING_JSON: str = "{}"

    # ─── Audit Export ──────────────────────────
    AUDIT_EXPORT_MAX_ROWS: int = 50000

    # ─── Bulk Document Operations ─────────────
    BULK_REINDEX_CONCURRENCY: int = 3

    # ─── Evaluation ───────────────────────────
    EVAL_MIN_FAITHFULNESS: float = 0.6
    EVAL_MIN_TRUST: float = 0.5
    EVAL_MIN_CONTEXT_PRECISION: float = 0.5
    EVAL_REFUSAL_ACCURACY_MIN: float = 0.7
    # An eval run still marked `running` after this long is presumed dead (the
    # worker crashed or the process restarted mid-run). Stale rows are ignored
    # by the promotion gate and lazily marked `error`, so a lost background
    # task can never permanently wedge a prompt version.
    EVAL_RUN_STALE_SECONDS: int = 1800

    # ─── JWT Auth ────────────────────────────
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    JWT_ALGORITHM: str = "HS256"
    JWT_ISSUER: str = "veritasrag"

    # ─── WebSocket Stream Resume ──────────────
    # How long a finished stream stays replayable after its last frame, and how
    # many per-query buffers the in-memory registry may hold at once.
    WS_RESUME_TTL_SECONDS: int = 120
    WS_RESUME_MAX_BUFFERS: int = 500
    # Per-buffer frame ceiling. One streamed token is one frame (~410 B), so this
    # bounds a single answer's replay buffer at roughly 0.6 MB. A stream that
    # exceeds it keeps streaming but stops being resumable (its buffer is
    # released and dropped) — never truncated, which would put gaps in `seq`.
    WS_RESUME_MAX_FRAMES_PER_BUFFER: int = 1500
    # Concurrent in-flight /ws/query pipelines per user. Because a disconnect no
    # longer cancels the pipeline, this is what stops repeated connect-query-drop
    # cycles from piling up generations.
    WS_MAX_INFLIGHT_PER_USER: int = 3
    # How long shutdown waits for detached pipelines to finish persisting before
    # the DB engine is disposed.
    WS_SHUTDOWN_DRAIN_SECONDS: int = 10

    # ─── Rate Limiting ────────────────────────
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_REQUESTS: int = 30
    RATE_LIMIT_WINDOW: int = 60

    # ─── Logging ──────────────────────────────
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: Literal["json", "text"] = "text"

    # ─── Data Paths ───────────────────────────
    DATA_DIR: str = "./data"
    UPLOAD_DIR: str = "./data/uploads"
    BM25_INDEX_DIR: str = "./data/bm25"
    TRUST_MODEL_DIR: str = "./data/models"

    # ─── PII Redaction ────────────────────────
    PII_REDACTION_ENABLED: bool = True
    PII_ENTITIES: str = "EMAIL,PHONE,SSN,CREDIT_CARD,ADDRESS"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.APP_CORS_ORIGINS.split(",") if o.strip()]

    @property
    def upload_path(self) -> Path:
        return Path(self.UPLOAD_DIR)

    @property
    def bm25_path(self) -> Path:
        return Path(self.BM25_INDEX_DIR)

    @property
    def chroma_path(self) -> Path:
        return Path(self.CHROMA_PERSIST_DIR)

    @property
    def data_path(self) -> Path:
        return Path(self.DATA_DIR)

    @property
    def pii_entities_list(self) -> list[str]:
        return [e.strip() for e in self.PII_ENTITIES.split(",") if e.strip()]

    @field_validator("APP_SECRET_KEY")
    @classmethod
    def validate_app_secret_key(cls, value: str) -> str:
        weak_keys = {
            "change-me-in-production-openssl-rand-hex-32",
            "dev-secret-key-openssl-rand-hex-32-12345678",
            "dev-secret-key",
            "secret",
            "changeme",
        }
        if len(value) < 32 or value in weak_keys:
            raise ValueError("APP_SECRET_KEY must be at least 32 chars and not a known weak default")
        return value


# pydantic-settings populates required fields (e.g. APP_SECRET_KEY) from the
# environment / .env at runtime; BaseSettings' __init__ stub can't model that.
settings = Settings()  # type: ignore[call-arg]
