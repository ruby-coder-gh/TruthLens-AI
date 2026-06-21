"""Application configuration via pydantic-settings."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

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
    APP_SECRET_KEY: str = "change-me-in-production-openssl-rand-hex-32"
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
    OLLAMA_PRIMARY_MODEL: str = "llama3.1:8b"
    OLLAMA_FALLBACK_MODEL: str = "phi3:3b"
    OLLAMA_EMBED_MODEL: str = "bge-base:latest"
    OLLAMA_RERANK_MODEL: str = "bge-reranker:latest"
    OLLAMA_TIMEOUT: int = 120
    OLLAMA_MAX_TOKENS: int = 2048
    OLLAMA_TEMPERATURE: float = 0.3
    OLLAMA_TOP_P: float = 0.9
    OLLAMA_NUM_CTX: int = 4096

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

    # ─── Guardrail ────────────────────────────
    GUARDRAIL_THRESHOLD: float = 0.7
    GUARDRAIL_MAX_RETRIES: int = 3
    GUARDRAIL_NLI_MODEL: str = "cross-encoder/nli-deberta-v3-base"

    # ─── Chunking ─────────────────────────────
    CHUNK_SIZE: int = 512
    CHUNK_OVERLAP: int = 64
    CHUNK_SEPARATORS: list[str] = ["\n\n", "\n", ".", "!", "?", ",", " ", ""]

    # ─── Query Rewriting ──────────────────────
    REWRITE_ENABLED: bool = True
    REWRITE_TEMPERATURE: float = 0.2
    REWRITE_MAX_TOKENS: int = 256

    # ─── Trust Score ──────────────────────────
    TRUST_RETRIEVAL_WEIGHT: float = 0.3
    TRUST_FAITHFULNESS_WEIGHT: float = 0.4
    TRUST_RELEVANCE_WEIGHT: float = 0.2
    TRUST_SOURCE_WEIGHT: float = 0.1

    # ─── JWT Auth ────────────────────────────
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    JWT_ALGORITHM: str = "HS256"
    JWT_ISSUER: str = "veritasrag"

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


settings = Settings()
