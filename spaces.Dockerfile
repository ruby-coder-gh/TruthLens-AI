# HF Spaces Dockerfile — Ollama + App
FROM ollama/ollama:latest AS ollama

FROM python:3.11-slim

WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc curl \
    && rm -rf /var/lib/apt/lists/*

# Copy Ollama binary from official image
COPY --from=ollama /usr/bin/ollama /usr/bin/ollama

# Copy app code
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# Copy startup script
COPY hf_spaces_setup.sh /app/hf_spaces_setup.sh
RUN chmod +x /app/hf_spaces_setup.sh

# Data dirs
RUN mkdir -p /app/data /app/data/uploads /app/data/chromadb /app/data/bm25 /app/data/models

# HF Spaces uses port 7860
EXPOSE 7860

# Startup: Ollama background + model pull + app
CMD ["bash", "/app/hf_spaces_setup.sh"]
