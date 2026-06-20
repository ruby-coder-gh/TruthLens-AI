"""Golden dataset for RAG pipeline evaluation.

Each entry: {question, reference_answer, source_documents, expected_grounding, category, difficulty, notes}

Run evaluation: python -m evaluation.evaluate --model qwen3:4b
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class GoldenEntry:
    """Single golden dataset entry."""
    question: str
    reference_answer: str
    source_documents: list[str] = field(default_factory=list)
    expected_grounding: bool = True
    category: str = "answerable"
    difficulty: int = 1
    notes: str = ""


GOLDEN_DATASET: list[GoldenEntry] = [
    # ═══════════════════════════════════════════════════════════════
    # ANSWERABLE — General / Product Overview (gd-001 → gd-010)
    # Converted from existing entries
    # ═══════════════════════════════════════════════════════════════
    GoldenEntry(
        question="What is VeritasRAG?",
        reference_answer=(
            "VeritasRAG is an offline-first, enterprise-grade RAG (Retrieval-Augmented Generation) "
            "platform. It allows users to ask natural-language questions over private documents. "
            "Answers are grounded, cited, confidence-scored, and generated 100% locally with no paid APIs."
        ),
        source_documents=["ARCHITECTURE.md", "README.md", "PROJECT.md"],
        expected_grounding=True,
        category="answerable",
        difficulty=1,
        notes="Core product description — every RAG system must nail this.",
    ),
    GoldenEntry(
        question="How does the guardrail system detect hallucinations?",
        reference_answer=(
            "The guardrail system uses an NLI (Natural Language Inference) model (microsoft/deberta-v3-base) "
            "to check each claim in the generated answer against the source contexts. "
            "It extracts individual claims from the answer, compares each against the context using "
            "a CrossEncoder NLI model, and computes an entailment ratio. If the ratio falls below "
            "the configured threshold (default 0.7), the claim is flagged as unsupported."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/generation/guardrail.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=3,
        notes="NLI-based hallucination detection with configurable threshold.",
    ),
    GoldenEntry(
        question="What embedding model does VeritasRAG use?",
        reference_answer=(
            "VeritasRAG uses BAAI/bge-base-en-v1.5 as the default embedding model "
            "with a dimension of 768. It runs on CPU by default and uses sentence-transformers."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/config.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=1,
        notes="Default embedding model reference.",
    ),
    GoldenEntry(
        question="How is the trust score calculated?",
        reference_answer=(
            "The trust score is a weighted composite of four signals: "
            "retrieval quality (30% weight, based on top retrieval scores), "
            "faithfulness (40%, from guardrail NLI score), "
            "relevance (20%, based on answer length and guardrail pass), and "
            "source authority (10%, based on number of unique documents cited). "
            "The overall score is clamped to [0, 1]."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/evaluation/trust_score.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=3,
        notes="Trust score breakdown with component weights.",
    ),
    GoldenEntry(
        question="What file formats does VeritasRAG support?",
        reference_answer=(
            "VeritasRAG supports PDF, DOCX, TXT, Markdown, and CSV file formats. "
            "PDFs are processed using PyMuPDF (fitz), DOCX files use python-docx, "
            "and Markdown files are parsed with the markdown library."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/ingestion/loader.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=1,
        notes="Supported file upload types.",
    ),
    GoldenEntry(
        question="What is the CRAG self-correction loop?",
        reference_answer=(
            "CRAG (Corrective RAG) is a self-correction loop that improves retrieval quality. "
            "If retrieval results are insufficient, it expands the query with variations and re-retrieves. "
            "If the guardrail detects issues, it can re-expand and re-retrieve. "
            "Max 3 retrieval attempts before falling back to the Phi-3 model with relaxed constraints."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/graph/crag_graph.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=3,
        notes="Self-correction loop with retry and fallback.",
    ),
    GoldenEntry(
        question="Which LLMs are supported by VeritasRAG?",
        reference_answer=(
            "VeritasRAG uses Ollama for local LLM inference. The primary model is Llama 3.1 8B, "
            "with Phi-3 3B as fallback for lower-resource environments. "
            "The embedding model is BAAI/bge-base-en-v1.5 via sentence-transformers. "
            "The reranker model is BAAI/bge-reranker-v2-m3."
        ),
        source_documents=["ARCHITECTURE.md", "PROJECT.md", "backend/app/config.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=1,
        notes="Supported models across all pipeline stages.",
    ),
    GoldenEntry(
        question="Does VeritasRAG use any paid APIs?",
        reference_answer=(
            "No. VeritasRAG is designed to be entirely free and open-source. "
            "All models run locally via Ollama (Llama 3.1, Phi-3) and sentence-transformers. "
            "No paid APIs are required. It is fully offline-capable."
        ),
        source_documents=["PROJECT.md", "README.md"],
        expected_grounding=True,
        category="answerable",
        difficulty=1,
        notes="Zero paid-API dependency — core differentiator.",
    ),
    GoldenEntry(
        question="How does hybrid search work in VeritasRAG?",
        reference_answer=(
            "Hybrid search combines vector similarity (from ChromaDB embeddings) with BM25 keyword "
            "search using Reciprocal Rank Fusion (RRF). The default weights are 0.7 for vector "
            "and 0.3 for BM25. Results are then re-ranked using a cross-encoder "
            "(BAAI/bge-reranker-v2-m3) with a weight of 0.6."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/retrieval/hybrid_search.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=3,
        notes="Hybrid fusion with RRF and cross-encoder reranking.",
    ),
    GoldenEntry(
        question="What database does VeritasRAG use?",
        reference_answer=(
            "VeritasRAG uses SQLite (via SQLAlchemy async with aiosqlite) for application data "
            "including users, workspaces, documents, chunks, queries, feedback, and audit logs. "
            "ChromaDB is used as the vector store for document embeddings. "
            "BM25 indexes are stored as JSON files on disk."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/config.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=1,
        notes="Database stack: SQLite + ChromaDB + BM25.",
    ),
    # ═══════════════════════════════════════════════════════════════
    # ANSWERABLE — Financial & Usage Metrics (gd-011 → gd-015)
    # ═══════════════════════════════════════════════════════════════
    GoldenEntry(
        question="What is the maximum file upload size?",
        reference_answer=(
            "The maximum file upload size is 50 MB (52,428,800 bytes), configured via "
            "the SERVER_MAX_UPLOAD_SIZE environment variable."
        ),
        source_documents=["backend/app/config.py", "ARCHITECTURE.md"],
        expected_grounding=True,
        category="answerable",
        difficulty=1,
        notes="Upload size limit from config.",
    ),
    GoldenEntry(
        question="How many queries per minute are allowed per user?",
        reference_answer=(
            "The default rate limit is 30 requests per 60-second window per user. "
            "Rate limiting is enabled by default in production and can be configured "
            "via RATE_LIMIT_REQUESTS and RATE_LIMIT_WINDOW env vars."
        ),
        source_documents=["backend/app/config.py", "ARCHITECTURE.md"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="Rate limiting defaults.",
    ),
    GoldenEntry(
        question="What is the Ollama model timeout setting?",
        reference_answer=(
            "The Ollama timeout is set to 120 seconds (OLLAMA_TIMEOUT). "
            "The max tokens per generation is 2048 (OLLAMA_MAX_TOKENS), "
            "and the temperature is set to 0.3 for factual answers."
        ),
        source_documents=["backend/app/config.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=1,
        notes="Ollama generation parameters.",
    ),
    GoldenEntry(
        question="What model sizes are required for different RAM configurations?",
        reference_answer=(
            "Llama 3.1 8B requires approximately 4.7 GB of RAM, while Phi-3 3B requires "
            "about 2.2 GB. In light mode (LIGHT_MODE=true), the system uses qwen3:4b and "
            "skips the vision model for 8 GB RAM environments."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/config.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="Model RAM requirements and light mode.",
    ),
    GoldenEntry(
        question="What is the target hallucination rate?",
        reference_answer=(
            "The target hallucination rate is less than 3% of queries where the guardrail "
            "fails. The guardrail uses a default threshold of 0.7 entailment ratio. "
            "If a response falls below this threshold, the CRAG loop can retry up to 3 times."
        ),
        source_documents=["ARCHITECTURE.md"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="Hallucination rate SLI and guardrail threshold.",
    ),
    # ═══════════════════════════════════════════════════════════════
    # ANSWERABLE — Technical: Configuration (gd-016 → gd-025)
    # ═══════════════════════════════════════════════════════════════
    GoldenEntry(
        question="What are the default chunk size and overlap settings?",
        reference_answer=(
            "The default chunk size is 512 tokens and the chunk overlap is 64 tokens. "
            "Chunk separators are configured as newlines, periods, question marks, exclamation "
            "points, commas, spaces, and empty string as the final fallback."
        ),
        source_documents=["backend/app/config.py", "ARCHITECTURE.md"],
        expected_grounding=True,
        category="answerable",
        difficulty=1,
        notes="Chunking parameters from config.",
    ),
    GoldenEntry(
        question="How does query rewriting work?",
        reference_answer=(
            "Query rewriting is enabled by default (REWRITE_ENABLED=true). It uses an LLM "
            "with temperature 0.2 and max 256 tokens to reformulate the user's query for "
            "better retrieval. The rewritten query replaces the original for hybrid search."
        ),
        source_documents=["backend/app/config.py", "backend/app/retrieval/query_rewrite.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="Query rewriting configuration and flow.",
    ),
    GoldenEntry(
        question="What is the JWT token lifecycle?",
        reference_answer=(
            "Access tokens expire in 30 minutes (JWT_ACCESS_TOKEN_EXPIRE_MINUTES), "
            "while refresh tokens last 7 days (JWT_REFRESH_TOKEN_EXPIRE_DAYS). "
            "Tokens use HS256 algorithm with issuer 'veritasrag'. "
            "Refresh tokens are rotated on each use."
        ),
        source_documents=["backend/app/config.py", "ARCHITECTURE.md"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="Auth token expiry and rotation.",
    ),
    GoldenEntry(
        question="What is the PII redaction configuration?",
        reference_answer=(
            "PII redaction is enabled by default (PII_REDACTION_ENABLED=true). "
            "The detected entity types are: EMAIL, PHONE, SSN, CREDIT_CARD, and IP. "
            "It uses Microsoft Presidio for entity detection and anonymization."
        ),
        source_documents=["backend/app/config.py", "backend/app/utils/pii_redactor.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="PII redaction entities and tooling.",
    ),
    GoldenEntry(
        question="What is the retrieval top_k configuration?",
        reference_answer=(
            "The initial retrieval count is 10 (RETRIEVAL_TOP_K), which is then reduced "
            "to 5 after re-ranking (RETRIEVAL_RERANK_K). Results below a minimum score "
            "of 0.3 (RETRIEVAL_MIN_SCORE) are filtered out."
        ),
        source_documents=["backend/app/config.py", "ARCHITECTURE.md"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="Retrieval counts and score filtering.",
    ),
    GoldenEntry(
        question="What is the guardrail NLI model and how is it configured?",
        reference_answer=(
            "The guardrail uses microsoft/deberta-v3-base as the NLI model for claim "
            "entailment checking. The threshold is 0.7, meaning at least 70% of claims "
            "must be entailed by the source contexts. Max retries is 3 (GUARDRAIL_MAX_RETRIES)."
        ),
        source_documents=["backend/app/config.py", "ARCHITECTURE.md"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="NLI model and guardrail parameters.",
    ),
    GoldenEntry(
        question="What is the ChromaDB collection naming convention?",
        reference_answer=(
            "ChromaDB collections are named using the pattern ws_{workspace_id}_chunks, "
            "where the prefix is configurable via CHROMA_COLLECTION_PREFIX (default 'ws_'). "
            "The distance function used is cosine similarity."
        ),
        source_documents=["ARCHITECTURE.md"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="ChromaDB collection scheme.",
    ),
    GoldenEntry(
        question="What embedding dimension does VeritasRAG use?",
        reference_answer=(
            "The BAAI/bge-base-en-v1.5 embedding model produces 768-dimensional vectors. "
            "The embedding device defaults to CPU, with MPS (Apple Silicon) and CUDA as options. "
            "Sentence-transformers is used for local embedding inference."
        ),
        source_documents=["backend/app/config.py", "ARCHITECTURE.md"],
        expected_grounding=True,
        category="answerable",
        difficulty=1,
        notes="Embedding dimension and device configuration.",
    ),
    GoldenEntry(
        question="What logging configuration does VeritasRAG use?",
        reference_answer=(
            "The default log level is INFO with text format in development. "
            "In production, log format switches to JSON. Structured logging is "
            "implemented using the structlog library."
        ),
        source_documents=["backend/app/config.py", "ARCHITECTURE.md"],
        expected_grounding=True,
        category="answerable",
        difficulty=1,
        notes="Logging levels and format.",
    ),
    GoldenEntry(
        question="How is the BM25 index stored?",
        reference_answer=(
            "BM25 indexes are stored as JSON files on disk under data/bm25/{workspace_id}/. "
            "The implementation uses rank_bm25 library with BM25Okapi variant. "
            "Indexes are rebuilt incrementally on each document upload."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/config.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="BM25 storage and library choice.",
    ),
    # ═══════════════════════════════════════════════════════════════
    # ANSWERABLE — Technical: Architecture & Performance (gd-026 → gd-035)
    # ═══════════════════════════════════════════════════════════════
    GoldenEntry(
        question="What is the structure of a Query in the data model?",
        reference_answer=(
            "The Query model stores query_text, rewritten_query, response_text, "
            "response_sources as JSON, trust_score (0.0-1.0), guardrail_score, "
            "guardrail_passed boolean, model_used, latency_ms, and token_count. "
            "Each query is linked to a workspace and optionally a user."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/models/query.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="Query model schema details.",
    ),
    GoldenEntry(
        question="How are sources cited in generated answers?",
        reference_answer=(
            "The citation system (Citer protocol) matches answer spans back to source chunks. "
            "Each CitedSpan contains the text, chunk_id, start_index, and end_index. "
            "Sources are sent to the client via the 'sources' WebSocket message type "
            "after retrieval and before generation begins."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/generation/citer.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=3,
        notes="Citation mechanism and data format.",
    ),
    GoldenEntry(
        question="What is the ingestion pipeline data flow?",
        reference_answer=(
            "The ingestion pipeline follows: Loader loads document pages, Chunker splits "
            "into overlapping chunks, Embedder converts chunks to 768-dim vectors, and "
            "Indexer stores embeddings in ChromaDB and updates BM25 index. "
            "Document status transitions from pending → processing → ready."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/ingestion/"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="Full ingestion pipeline stages.",
    ),
    GoldenEntry(
        question="What is the LangGraph state structure?",
        reference_answer=(
            "GraphState is a TypedDict containing query, rewritten_query, workspace_id, "
            "user_id, query_id, top_k, filters, retrieval_results, reranked_results, "
            "contexts, response_text, cited_spans, guardrail_result, guardrail_retry_count, "
            "trust_score, model_used, latency_ms, and error fields."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/graph/"],
        expected_grounding=True,
        category="answerable",
        difficulty=4,
        notes="LangGraph state holds everything passed between pipeline nodes.",
    ),
    GoldenEntry(
        question="What WebSocket message types exist for query streaming?",
        reference_answer=(
            "Server-to-client messages include: ack (query received), token (streaming tokens), "
            "stream_end (generation complete), sources (retrieved chunks), guardrail (NLI result), "
            "trust_score (confidence composite), complete (final metadata), progress (phase updates), "
            "and error (failure codes)."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/api/ws.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=3,
        notes="Full WebSocket protocol message catalog.",
    ),
    GoldenEntry(
        question="What are the workspace member roles?",
        reference_answer=(
            "Workspace members have three roles: owner (full control, can delete workspace), "
            "editor (can upload documents and query), and viewer (read-only access to query "
            "and view documents). The workspace creator automatically becomes the owner."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/models/workspace.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="RBAC within workspaces.",
    ),
    GoldenEntry(
        question="What performance targets does VeritasRAG aim for?",
        reference_answer=(
            "Key SLIs include: ingestion throughput ≥50 pages/min, P95 query latency <10s, "
            "P95 time-to-first-token <2s, retrieval latency <500ms, generation latency <8s "
            "for 512 tokens, guardrail latency <1s, hallucination rate <3%, and uptime 99%."
        ),
        source_documents=["ARCHITECTURE.md"],
        expected_grounding=True,
        category="answerable",
        difficulty=3,
        notes="Performance targets for each pipeline stage.",
    ),
    GoldenEntry(
        question="How does the audit log system work?",
        reference_answer=(
            "Audit logs capture user_id, action (e.g. 'document.upload', 'query.run'), "
            "resource_type, resource_id, details (JSON metadata), and ip_address. "
            "The action naming convention follows {resource}.{operation} format. "
            "Logs are stored in the audit_logs SQLite table."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/models/audit_log.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="Audit trail architecture and schema.",
    ),
    GoldenEntry(
        question="What is the minimum password policy?",
        reference_answer=(
            "Passwords must be at least 8 characters long, contain at least one uppercase "
            "letter, and at least one digit. Password hashing uses bcrypt via passlib. "
            "The account locks for 15 minutes after 5 consecutive failed login attempts."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/core/auth.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="Password complexity and account lockout policy.",
    ),
    # ═══════════════════════════════════════════════════════════════
    # ANSWERABLE — Technical: Pipeline Details (gd-036 → gd-050)
    # ═══════════════════════════════════════════════════════════════
    GoldenEntry(
        question="What happens when the guardrail fails?",
        reference_answer=(
            "When the guardrail fails (entailment ratio below 0.7), the CRAG loop triggers: "
            "if retry_count < 3, the query is expanded with variations and re-retrieved. "
            "If retry_count >= 3, the system falls back to Phi-3 model with relaxed "
            "constraints and generates without guardrail enforcement."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/graph/crag_graph.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=3,
        notes="Guardrail failure recovery flow.",
    ),
    GoldenEntry(
        question="What password hashing algorithm is used?",
        reference_answer=(
            "VeritasRAG uses bcrypt for password hashing via the passlib library. "
            "The core.auth module handles JWT encoding/decoding with python-jose "
            "and password hashing operations."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/core/auth.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=1,
        notes="Auth hashing details.",
    ),
    GoldenEntry(
        question="What HTTP error codes does the API return?",
        reference_answer=(
            "The API uses standard HTTP codes with custom error codes: "
            "400 (INVALID_INPUT), 401 (UNAUTHORIZED/TOKEN_EXPIRED), 403 (FORBIDDEN), "
            "404 (NOT_FOUND), 409 (CONFLICT), 413 (TOO_LARGE), 415 (UNSUPPORTED_TYPE), "
            "429 (RATE_LIMITED), 422 (GUARDRAIL_FAILED), 500 (INGESTION_FAILED/INTERNAL_ERROR), "
            "and 503 (LLM_UNAVAILABLE)."
        ),
        source_documents=["ARCHITECTURE.md"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="API error code mapping.",
    ),
    GoldenEntry(
        question="How is the Document model structured?",
        reference_answer=(
            "The Document model tracks: id (UUID), workspace_id, filename (server-side), "
            "original_filename, mime_type, file_size (bytes), page_count (PDFs), chunk_count, "
            "status (pending/processing/ready/failed), error_message, uploaded_by, and timestamps. "
            "Documents cascade-delete their chunks and vector embeddings."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/models/document.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="Document entity schema.",
    ),
    GoldenEntry(
        question="What is the default Ollama context window size?",
        reference_answer=(
            "The default context window (OLLAMA_NUM_CTX) is 4096 tokens. "
            "The temperature defaults to 0.3 for factual responses, and top_p is 0.9. "
            "In light mode, these settings may be reduced for memory-constrained environments."
        ),
        source_documents=["backend/app/config.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=1,
        notes="Ollama context and generation parameters.",
    ),
    GoldenEntry(
        question="How is feedback stored and used?",
        reference_answer=(
            "Feedback is stored in the feedback table with a 1-5 rating, optional comment, "
            "linked to a query_id and user_id. The feedback_loop module processes feedback "
            "to trigger re-evaluation and update trust score calibration. "
            "A foreign key from feedback to queries ensures referential integrity."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/evaluation/feedback_loop.py", "backend/app/models/feedback.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="Feedback storage and processing loop.",
    ),
    GoldenEntry(
        question="What algorithm does the reranker use?",
        reference_answer=(
            "The reranker uses a cross-encoder model (BAAI/bge-reranker-v2-m3) for more "
            "precise relevance scoring than bi-encoder dot products. The rerank score is "
            "combined with hybrid search scores using a weight of 0.6 for the final ordering."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/retrieval/reranker.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="Cross-encoder reranking approach.",
    ),
    GoldenEntry(
        question="What is the RAGAS evaluation approach?",
        reference_answer=(
            "RAGAS evaluation computes faithfulness, answer_relevance, context_precision, "
            "context_recall, and optionally answer_correctness. It operates on lists of "
            "queries, answers, and context lists. The ragas_eval module wraps these "
            "computations with async support."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/evaluation/ragas_eval.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=3,
        notes="RAGAS metrics and module structure.",
    ),
    GoldenEntry(
        question="What are the CORS settings?",
        reference_answer=(
            "Default CORS origins are http://localhost:5173 (Vite dev server) and "
            "http://localhost:4000. In production, CORS must be explicitly whitelisted "
            "with no wildcard allowed. Methods and headers are restricted via middleware."
        ),
        source_documents=["backend/app/config.py", "ARCHITECTURE.md"],
        expected_grounding=True,
        category="answerable",
        difficulty=1,
        notes="CORS origin configuration.",
    ),
    GoldenEntry(
        question="What happens when a document is deleted?",
        reference_answer=(
            "Deleting a document triggers: ChromaDB collection.delete with document_id filter, "
            "BM25 index entry removal, and SQLite CASCADE delete of the document and all "
            "associated chunks. The entire operation is transactional to prevent sync issues."
        ),
        source_documents=["ARCHITECTURE.md"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="Document deletion cleanup across all stores.",
    ),
    GoldenEntry(
        question="What is the response envelope format?",
        reference_answer=(
            "Success responses wrap data in a 'data' key with optional 'meta' for pagination "
            "(page, page_size, total). Error responses include 'error' with code, message, "
            "and optional details dict. Paginated list endpoints return this envelope format."
        ),
        source_documents=["ARCHITECTURE.md"],
        expected_grounding=True,
        category="answerable",
        difficulty=1,
        notes="API response structure conventions.",
    ),
    GoldenEntry(
        question="What is the investigation graph?",
        reference_answer=(
            "The investigation graph is a multi-step research agent that decomposes complex "
            "queries into sub-questions, retrieves context for each, and synthesizes results. "
            "It is a separate LangGraph pipeline from the standard query_graph and crag_graph."
        ),
        source_documents=["PROJECT.md", "backend/app/graph/"],
        expected_grounding=True,
        category="answerable",
        difficulty=4,
        notes="Advanced multi-step research capability.",
    ),
    GoldenEntry(
        question="How are document chunks token-counted?",
        reference_answer=(
            "Each chunk stores an approximate token count in the token_count column. "
            "Chunks are split with size 512 tokens and overlap 64 tokens using separators "
            "that respect sentence and paragraph boundaries for semantic coherence."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/ingestion/chunker.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="Chunk token accounting.",
    ),
    GoldenEntry(
        question="What library is used for PDF extraction?",
        reference_answer=(
            "PDF extraction uses PyMuPDF (fitz) library version 1.24.0. "
            "DOCX files are processed with python-docx 1.1.0, and Markdown files "
            "are parsed with the markdown library 3.6.0."
        ),
        source_documents=["ARCHITECTURE.md"],
        expected_grounding=True,
        category="answerable",
        difficulty=1,
        notes="File parsing library versions.",
    ),
    GoldenEntry(
        question="What arguments does the GenerationInput dataclass accept?",
        reference_answer=(
            "GenerationInput accepts: query (required), rewritten_query (optional), "
            "contexts as list of dicts with chunk_id, content, score (optional), "
            "conversation_history as list of dicts (optional), and system_prompt (optional)."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/generation/generator.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=3,
        notes="Generator input interface contract.",
    ),
    GoldenEntry(
        question="What SQLAlchemy engine configuration does the app use?",
        reference_answer=(
            "VeritasRAG uses SQLAlchemy async engine with aiosqlite for SQLite connectivity. "
            "The DB_URL defaults to sqlite+aiosqlite:///./data/truthlens.db. "
            "The engine is configured declaratively with DeclarativeBase and common mixins "
            "including TimestampMixin and UUIDPkMixin for all models."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/database.py", "backend/app/models/base.py"],
        expected_grounding=True,
        category="answerable",
        difficulty=2,
        notes="Database engine configuration with SQLAlchemy async.",
    ),
    # ═══════════════════════════════════════════════════════════════
    # UNANSWERABLE — Out-of-corpus "trap" questions (gd-051 → gd-065)
    # ═══════════════════════════════════════════════════════════════
    GoldenEntry(
        question="What is the stock price of VeritasRAG?",
        reference_answer=(
            "This question cannot be answered from the available documents. "
            "VeritasRAG is an open-source software project, not a publicly traded company. "
            "No stock price information exists in the corpus."
        ),
        source_documents=[],
        expected_grounding=False,
        category="unanswerable",
        difficulty=1,
        notes="Trap: OSS project has no stock.",
    ),
    GoldenEntry(
        question="What is the weather forecast for tomorrow?",
        reference_answer=(
            "This question cannot be answered from the available documents. "
            "The VeritasRAG documentation contains no weather data or forecasting information."
        ),
        source_documents=[],
        expected_grounding=False,
        category="unanswerable",
        difficulty=1,
        notes="Weather is entirely outside corpus.",
    ),
    GoldenEntry(
        question="Who is the CEO of VeritasRAG?",
        reference_answer=(
            "This question cannot be answered from the available documents. "
            "VeritasRAG is an open-source project with no CEO or corporate structure "
            "documented in the corpus."
        ),
        source_documents=[],
        expected_grounding=False,
        category="unanswerable",
        difficulty=1,
        notes="Trap: OSS project has no CEO.",
    ),
    GoldenEntry(
        question="What is the best LLM for medical diagnosis?",
        reference_answer=(
            "This question cannot be answered from the available documents. "
            "The corpus contains no information about medical diagnosis or clinical LLM applications. "
            "VeritasRAG is a document Q&A platform, not a medical device."
        ),
        source_documents=[],
        expected_grounding=False,
        category="unanswerable",
        difficulty=2,
        notes="Trap: domain outside scope.",
    ),
    GoldenEntry(
        question="When will VeritasRAG support GPT-5?",
        reference_answer=(
            "This question cannot be answered from the available documents. "
            "VeritasRAG is designed for local models only and has no roadmap information "
            "about future model support. Future feature plans are not documented in the corpus."
        ),
        source_documents=[],
        expected_grounding=False,
        category="unanswerable",
        difficulty=1,
        notes="Trap: future events / roadmap.",
    ),
    GoldenEntry(
        question="How much does VeritasRAG cost for enterprise?",
        reference_answer=(
            "This question cannot be answered from the available documents. "
            "VeritasRAG is fully free and open-source with no paid tiers or enterprise pricing. "
            "The question incorrectly assumes a commercial product."
        ),
        source_documents=[],
        expected_grounding=False,
        category="unanswerable",
        difficulty=1,
        notes="Trap: incorrectly assumes paid product.",
    ),
    GoldenEntry(
        question="What is the best way to integrate VeritasRAG with Salesforce?",
        reference_answer=(
            "This question cannot be answered from the available documents. "
            "No Salesforce integration or CRM-related documentation exists in the corpus. "
            "The API contract does not mention any CRM system compatibility."
        ),
        source_documents=[],
        expected_grounding=False,
        category="unanswerable",
        difficulty=2,
        notes="Trap: integration with third-party not documented.",
    ),
    GoldenEntry(
        question="Compare VeritasRAG vs LangChain — which is better?",
        reference_answer=(
            "This question cannot be fully answered from the available documents. "
            "The corpus describes VeritasRAG as using LangChain under the hood, not as a competitor. "
            "A comparative analysis requires external sources not present in the corpus."
        ),
        source_documents=[],
        expected_grounding=False,
        category="unanswerable",
        difficulty=3,
        notes="Trap: false comparison framing.",
    ),
    GoldenEntry(
        question="How do I contribute code to the VeritasRAG project?",
        reference_answer=(
            "This question cannot be answered from the available documents. "
            "No contributing guidelines, code of conduct, or PR process documentation "
            "exists in the current corpus."
        ),
        source_documents=[],
        expected_grounding=False,
        category="unanswerable",
        difficulty=1,
        notes="Missing contributor documentation.",
    ),
    GoldenEntry(
        question="What is the meaning of life?",
        reference_answer=(
            "This question cannot be answered from the available documents. "
            "The VeritasRAG corpus contains technical documentation about a RAG platform, "
            "not philosophical content."
        ),
        source_documents=[],
        expected_grounding=False,
        category="unanswerable",
        difficulty=1,
        notes="Trap: philosophical question outside scope.",
    ),
    GoldenEntry(
        question="What are the 2025 revenue figures for the company behind VeritasRAG?",
        reference_answer=(
            "This question cannot be answered from the available documents. "
            "VeritasRAG is an open-source project with no associated company or "
            "financial reporting in the corpus."
        ),
        source_documents=[],
        expected_grounding=False,
        category="unanswerable",
        difficulty=1,
        notes="Trap: financial data not in corpus.",
    ),
    GoldenEntry(
        question="Will VeritasRAG add support for PostgreSQL in the next release?",
        reference_answer=(
            "This question cannot be answered from the available documents. "
            "While the ADR notes PostgreSQL as a future migration path, no release "
            "timeline or commitment exists in the corpus. Questions about future releases "
            "are speculative."
        ),
        source_documents=[],
        expected_grounding=False,
        category="unanswerable",
        difficulty=2,
        notes="Trap: future release planning.",
    ),
    GoldenEntry(
        question="How does VeritasRAG compare to ChatGPT?",
        reference_answer=(
            "This question cannot be answered from the available documents. "
            "The corpus contains no competitive analysis or comparison with other products. "
            "VeritasRAG is a document-grounded RAG platform, fundamentally different from general-purpose chatbots."
        ),
        source_documents=[],
        expected_grounding=False,
        category="unanswerable",
        difficulty=2,
        notes="Trap: apples-to-oranges comparison.",
    ),
    GoldenEntry(
        question="What is the calorie count of a VeritasRAG server?",
        reference_answer=(
            "This question cannot be answered from the available documents. "
            "Servers do not have caloric content. The question is nonsensical "
            "and has no answer in any documentation."
        ),
        source_documents=[],
        expected_grounding=False,
        category="unanswerable",
        difficulty=1,
        notes="Trap: absurd/physical property question.",
    ),
    GoldenEntry(
        question="Can VeritasRAG run on Kubernetes with 1000 nodes?",
        reference_answer=(
            "This question cannot be answered from the available documents. "
            "The corpus describes single-server deployment only (Docker Compose with "
            "app + Ollama). No Kubernetes configuration, horizontal scaling docs, "
            "or distributed deployment guidance exists."
        ),
        source_documents=[],
        expected_grounding=False,
        category="unanswerable",
        difficulty=2,
        notes="Trap: scaling scenario beyond documented architecture.",
    ),
    # ═══════════════════════════════════════════════════════════════
    # AMBIGUOUS / SYNTHESIS — Cross-document + inference (gd-066 → gd-080)
    # ═══════════════════════════════════════════════════════════════
    GoldenEntry(
        question="What are the trade-offs between using Llama 3.1 8B and Phi-3 3B?",
        reference_answer=(
            "Llama 3.1 8B provides higher quality answers but requires ~4.7 GB RAM "
            "and is slower on low-resource hardware. Phi-3 3B uses only ~2.2 GB RAM "
            "and is faster, making it suitable for 8 GB RAM environments or when light mode "
            "is enabled. The system auto-fallsback to Phi-3 after 3 failed guardrail retries. "
            "Both run locally via Ollama with no API costs."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/config.py", "PROJECT.md"],
        expected_grounding=True,
        category="ambiguous",
        difficulty=4,
        notes="Synthesize model comparison from architecture, config, and project docs.",
    ),
    GoldenEntry(
        question="How does VeritasRAG prevent hallucinations end-to-end?",
        reference_answer=(
            "Hallucination prevention is multi-layered. First, hybrid search with reranking "
            "ensures only relevant context is retrieved (vector + BM25 + cross-encoder). "
            "Second, the NLI guardrail (deberta-v3-base) checks each claim against source contexts "
            "with a 0.7 entailment threshold. Third, the CRAG loop retries with expanded queries "
            "up to 3 times on failure. Fourth, low trust scores (composite of retrieval quality, "
            "faithfulness, relevance, source authority) signal uncertainty. Finally, Phi-3 fallback "
            "with relaxed constraints handles edge cases."
        ),
        source_documents=[
            "ARCHITECTURE.md",
            "backend/app/generation/guardrail.py",
            "backend/app/retrieval/hybrid_search.py",
            "backend/app/graph/crag_graph.py",
            "backend/app/evaluation/trust_score.py",
        ],
        expected_grounding=True,
        category="ambiguous",
        difficulty=5,
        notes="Synthesis across retrieval, guardrail, CRAG, and trust score.",
    ),
    GoldenEntry(
        question="What security measures protect user data?",
        reference_answer=(
            "Security is multi-faceted: JWT auth with short-lived access tokens (30 min) "
            "and rotating refresh tokens (7 days), bcrypt password hashing with minimum "
            "8-char policy, account lockout after 5 failed attempts, rate limiting "
            "(30 req/min), PII redaction via Presidio (EMAIL, PHONE, SSN, CREDIT_CARD, IP), "
            "CORS whitelist (no wildcard), restricted HTTP methods, audit logging for all "
            "write operations, and input validation at all API layers. "
            "Ollama is bound to localhost to prevent external LLM access."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/core/auth.py", "backend/app/core/security.py", "docs/security/audit_report.md"],
        expected_grounding=True,
        category="ambiguous",
        difficulty=4,
        notes="Synthesize security posture from multiple docs.",
    ),
    GoldenEntry(
        question="How does a document move from upload to being queryable?",
        reference_answer=(
            "The flow: (1) User POSTs a file (PDF/DOCX/TXT/MD/CSV) via multipart form. "
            "(2) API creates Document record with status='pending' and returns 202. "
            "(3) Background ingestion pipeline fires: Loader extracts page text, Chunker "
            "splits into 512-token chunks with 64-token overlap, Embedder converts to "
            "768-dim vectors via BGE-base, Indexer upserts to ChromaDB and updates BM25 "
            "index. (4) Document status updated to 'ready' with chunk_count. "
            "(5) User can now query via WebSocket — the retrieval pipeline searches "
            "ChromaDB + BM25, reranks results, and generates grounded answers."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/ingestion/", "backend/app/models/document.py"],
        expected_grounding=True,
        category="ambiguous",
        difficulty=3,
        notes="Trace end-to-end document lifecycle.",
    ),
    GoldenEntry(
        question="What factors influence the trust score of an answer?",
        reference_answer=(
            "The trust score is a weighted composite: retrieval quality (30%) depends on "
            "top retrieval scores from hybrid search; faithfulness (40%) comes from the "
            "guardrail NLI entailment ratio; relevance (20%) considers answer length and "
            "whether guardrail passed; source authority (10%) reflects unique document count. "
            "If retrieval returns low-confidence results or the guardrail detects unsupported "
            "claims, the trust score drops. User feedback ratings (1-5) can also calibrate "
            "the score over time via the feedback loop."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/evaluation/trust_score.py", "backend/app/evaluation/feedback_loop.py"],
        expected_grounding=True,
        category="ambiguous",
        difficulty=4,
        notes="Synthesize trust score from component docs.",
    ),
    GoldenEntry(
        question="How does VeritasRAG handle document processing failures?",
        reference_answer=(
            "Document status transitions to 'failed' with an error_message on processing errors. "
            "Corrupt PDFs are handled with try/except in _load_pdf(). Ingestion uses async "
            "retry via tenacity for transient database locks. The guardrail has its own retry "
            "loop (max 3 attempts via CRAG). Ollama timeouts are configured at 120s. "
            "Large PDFs are stream-processed in 1 MB chunks to avoid OOM."
        ),
        source_documents=["ARCHITECTURE.md", "PROJECT.md", "backend/app/utils/retry.py"],
        expected_grounding=True,
        category="ambiguous",
        difficulty=3,
        notes="Cross-document failure handling patterns.",
    ),
    GoldenEntry(
        question="Compare vector search, BM25, and hybrid search approaches used.",
        reference_answer=(
            "Vector search uses BGE-base embeddings (768-dim) with cosine distance in ChromaDB "
            "for semantic similarity. BM25 keyword search (BM25Okapi) provides exact-match "
            "lexical retrieval. Hybrid search fuses both using Reciprocal Rank Fusion with "
            "0.7 vector / 0.3 BM25 weights, then re-ranks results with a cross-encoder "
            "(BGE-reranker-v2-m3) weighted at 0.6. This three-stage approach balances "
            "semantic understanding with keyword precision."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/retrieval/hybrid_search.py", "backend/app/retrieval/reranker.py"],
        expected_grounding=True,
        category="ambiguous",
        difficulty=4,
        notes="Compare three retrieval approaches from architecture and implementation.",
    ),
    GoldenEntry(
        question="What are the implications of the SQLite + ChromaDB architecture for scaling?",
        reference_answer=(
            "SQLite supports single-writer, multi-reader — adequate for single-server deployment. "
            "ChromaDB scales to ~1M chunks before performance degrades. The architecture "
            "documents migration paths: SQLite → PostgreSQL (swap aiosqlite for asyncpg, "
            "no ORM changes) and ChromaDB → Qdrant. BM25 is in-memory with JSON persistence, "
            "scaling to ~1M docs. For horizontal scale, the current architecture would need "
            "a stateless API layer, connection pooling, and distributed vector store."
        ),
        source_documents=["ARCHITECTURE.md"],
        expected_grounding=True,
        category="ambiguous",
        difficulty=4,
        notes="Synthesize scaling constraints and migration paths from ADRs.",
    ),
    GoldenEntry(
        question="How does the API design support both synchronous and streaming use cases?",
        reference_answer=(
            "The API uses dual protocol: REST for CRUD operations (auth, documents, feedback, "
            "admin) with standard JSON envelopes, and WebSocket for real-time query streaming. "
            "WS messages follow a typed protocol (ack, token, stream_end, sources, guardrail, "
            "trust_score, complete, error, progress). The REST layer handles 23+ endpoints with "
            "pagination, filtering, and standard error codes. This separation lets the frontend "
            "use simple REST for management and persistent WebSocket for interactive Q&A."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/api/", "PROJECT.md"],
        expected_grounding=True,
        category="ambiguous",
        difficulty=3,
        notes="Synthesize API surface from architecture and route modules.",
    ),
    GoldenEntry(
        question="How does the system decide whether to use the primary or fallback LLM?",
        reference_answer=(
            "The CRAG graph makes this decision: initially the primary model (Llama 3.1 8B) "
            "generates an answer. If the guardrail fails (entailment ratio < 0.7) and "
            "retry_count >= 3, the system falls back to Phi-3 3B with relaxed constraints "
            "and generates without guardrail enforcement. Light mode (LIGHT_MODE=true) "
            "defaults to qwen3:4b as both primary and fallback for 8 GB RAM environments."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/config.py", "backend/app/graph/crag_graph.py"],
        expected_grounding=True,
        category="ambiguous",
        difficulty=4,
        notes="Synthesize model selection logic from graph and config.",
    ),
    GoldenEntry(
        question="What monitoring and observability capabilities exist?",
        reference_answer=(
            "Observability includes: structured logging via structlog (JSON in production), "
            "Prometheus metrics (prometheus-client 0.20.0), audit logging for all write "
            "operations, query performance tracking (latency_ms, token_count, model_used), "
            "guardrail scoring, trust score computation, user feedback ratings (1-5), "
            "and admin stats/metrics endpoints. The Docker health check monitors uptime "
            "with a 99% target."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/config.py", "backend/app/models/audit_log.py", "backend/app/evaluation/trust_score.py"],
        expected_grounding=True,
        category="ambiguous",
        difficulty=3,
        notes="Cross-document synthesis of observability features.",
    ),
    GoldenEntry(
        question="What are the key differences between the standard query graph and the CRAG graph?",
        reference_answer=(
            "The standard query graph (query_graph.py) follows a linear path: rewrite_query → "
            "hybrid_search → rerank → generate → guardrail_check → compute_trust → done. "
            "The CRAG graph (crag_graph.py) adds conditional branching: after reranking, an "
            "LLM judge checks relevance; if insufficient, query_expansion triggers re-retrieval. "
            "After generation, failed guardrail triggers up to 3 retry iterations before "
            "fallback. CRAG also includes web_search node (optional) for online augmentation."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/graph/query_graph.py", "backend/app/graph/crag_graph.py"],
        expected_grounding=True,
        category="ambiguous",
        difficulty=5,
        notes="Compare LangGraph pipeline topologies.",
    ),
    GoldenEntry(
        question="How does the auth system protect against common attacks?",
        reference_answer=(
            "Against brute force: rate limiting (30 req/min), account lockout (5 failures "
            "→ 15 min lock), and bcrypt slow hashing. Against token theft: short-lived "
            "access tokens (30 min), rotating refresh tokens (7 days), httpOnly cookies in "
            "production. Against enumeration: combined error messages for login failures. "
            "Against CSRF: stateless JWT, no session cookies. Against injection: Pydantic "
            "input validation on all endpoints. CORS is restricted, HTTP methods are "
            "whitelisted, and security headers are applied via middleware."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/core/auth.py", "backend/app/core/security.py", "docs/security/audit_report.md"],
        expected_grounding=True,
        category="ambiguous",
        difficulty=4,
        notes="Synthesize defense-in-depth from architecture, audit, and implementation.",
    ),
    GoldenEntry(
        question="What is the complete data model relationship chain from User to Feedback?",
        reference_answer=(
            "User owns Workspaces (via owner_id). Workspace has Members (users with roles) "
            "and Documents. Documents have Chunks (ordered by index, content + token_count). "
            "Queries belong to a Workspace and optionally a User, referencing Sources "
            "(junction table linking Query to Chunk). Feedback links to a Query with "
            "rating 1-5 and optional comment. AuditLog records User actions across all "
            "resources. This chain ensures full auditability and workspace isolation."
        ),
        source_documents=["ARCHITECTURE.md", "backend/app/models/"],
        expected_grounding=True,
        category="ambiguous",
        difficulty=4,
        notes="Trace entity-relationship chain across all models.",
    ),
    GoldenEntry(
        question="What are the cost benefits of VeritasRAG compared to cloud RAG solutions?",
        reference_answer=(
            "VeritasRAG has zero API costs — all models run locally via Ollama and "
            "sentence-transformers. No per-query fees, no token billing, no vector store "
            "SaaS costs. The only cost is hardware (8 GB RAM minimum) and electricity. "
            "Cloud RAG solutions charge per token for embeddings, generation, and vector "
            "storage. Data never leaves the local machine, eliminating data egress costs. "
            "However, the trade-off is upfront model download (~7 GB total) and local "
            "compute requirements."
        ),
        source_documents=["PROJECT.md", "README.md", "ARCHITECTURE.md"],
        expected_grounding=True,
        category="ambiguous",
        difficulty=3,
        notes="Synthesize cost argument from project docs and architecture decisions.",
    ),
    # ═══════════════════════════════════════════════════════════════
    # ANSWERABLE — Developer / Operations (gd-051 re-labeled → actually gd-076+)
    # We need to fill to 80 — already at 80 above.
    # ═══════════════════════════════════════════════════════════════
]

# ─── ID Assignment ────────────────────────────────────────────────

def _assign_ids() -> None:
    """Assign sequential IDs to all entries."""
    for i, entry in enumerate(GOLDEN_DATASET, 1):
        id_str = f"gd-{i:03d}"
        entry.notes = f"[{id_str}] " + entry.notes if entry.notes else f"[{id_str}]"


_assign_ids()


# ─── Public API ──────────────────────────────────────────────────

def get_golden_dataset() -> list[GoldenEntry]:
    """Get the golden dataset entries as GoldenEntry objects."""
    return GOLDEN_DATASET


def get_entries_by_category(category: str) -> list[GoldenEntry]:
    """Filter golden dataset by category."""
    return [item for item in GOLDEN_DATASET if item.category == category]


def get_entries_by_difficulty(difficulty: int) -> list[GoldenEntry]:
    """Filter golden dataset by difficulty level."""
    return [item for item in GOLDEN_DATASET if item.difficulty == difficulty]


# ─── Statistics ──────────────────────────────────────────────────

def print_stats() -> None:
    """Print dataset statistics."""
    from collections import Counter
    cats = Counter(e.category for e in GOLDEN_DATASET)
    diffs = Counter(e.difficulty for e in GOLDEN_DATASET)
    answerable = sum(1 for e in GOLDEN_DATASET if e.expected_grounding)
    ungrounded = sum(1 for e in GOLDEN_DATASET if not e.expected_grounding)

    print(f"Golden dataset: {len(GOLDEN_DATASET)} entries")
    print(f"  Categories: {dict(cats)}")
    print(f"  Difficulty: {dict(sorted(diffs.items()))}")
    print(f"  Expected grounding: {answerable} yes / {ungrounded} no")
    print()


if __name__ == "__main__":
    print_stats()
    for entry in GOLDEN_DATASET:
        print(f"  {entry.notes.split(']')[0] + ']' if ']' in entry.notes else '??':<8} "
              f"({entry.category:<12} / d{entry.difficulty}) "
              f"{entry.question[:65]}...")
