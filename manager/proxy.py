from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.responses import StreamingResponse
import httpx
import logging
from .auth import select_account, increment_usage, set_account_status
import os

OLLAMA_API_BASE = os.getenv('OLLAMA_API_BASE', 'http://localhost:11434')
logger = logging.getLogger(__name__)

app = FastAPI(title="Ollama Account Manager Proxy")

@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
async def proxy(request: Request, path: str):
    account = select_account()
    if not account:
        raise HTTPException(status_code=503, detail="No healthy accounts available")
    token = account['token']
    headers = dict(request.headers)
    headers['Authorization'] = f'Bearer {token}'
    # Remove host header to avoid conflicts
    headers.pop('host', None)
    url = f"{OLLAMA_API_BASE}/{path}"
    # Prepare request
    method = request.method
    # Read body if present
    body = await request.body() if method in ("POST", "PUT", "PATCH") else None
    try:
        async with httpx.AsyncClient(timeout=None) as client:
            resp = await client.request(method, url, headers=headers, content=buf if (buf := body) else None, params=request.query_params)
    except httpx.RequestError as exc:
        logger.error(f"Request to Ollama failed: {exc}")
        raise HTTPException(status_code=502, detail=f"Ollama request failed: {exc}")
    # If we got 429 or similar, mark account as exhausted and retry? We'll handle in auth health check.
    # For simplicity, we just forward response.
    # Handle streaming
    if resp.headers.get('content-type', '').startswith('text/event-stream'):
        return StreamingResponse(resp.aiter_raw(), media_type=resp.headers.get('content-type'))
    return Response(content=resp.content, status_code=resp.status_code, headers=dict(resp.headers))