#!/bin/bash
# HF Spaces startup script — pulls required Ollama models on first boot
set -e

echo "=== VeritasRAG HF Spaces Startup ==="

# Wait for Ollama to be ready
echo "Waiting for Ollama..."
until ollama list >/dev/null 2>&1; do
    sleep 2
done
echo "Ollama ready."

# Pull required models
echo "Pulling Llama 3.1 8B..."
ollama pull llama3.1:8b 2>&1

echo "Pulling LLaVA 7B (vision)..."
ollama pull llava:7b 2>&1

echo "Pulling embedding model..."
ollama pull nomic-embed-text 2>&1

echo "=== All models ready ==="

# Start the FastAPI app
exec uvicorn app.main:app --host 0.0.0.0 --port 7860
