from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
import uvicorn
from dotenv import dotenv_values
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

APP_ROOT = Path(__file__).resolve().parent / "app"
BACKEND_ROOT = APP_ROOT / "backend"
ENV_FILE = BACKEND_ROOT / ".env"
DATA_ROOT = Path(os.getenv("LOCALAPPDATA", Path.home())) / "AI TaskFlow" / "vercel-edition"
PAIRINGS_FILE = DATA_ROOT / "pairings.json"
ASSISTANT_HOST = "127.0.0.1"
ASSISTANT_PORT = 17411
PAIR_CODE_TTL_SECONDS = 600
MAX_REQUEST_BYTES = 275 * 1024 * 1024
DEVICE_ROUTE_PATTERNS = (
    re.compile(r"^/api/programming/run$"),
    re.compile(r"^/api/programming/workspace(?:/[a-f0-9]{32})?$"),
    re.compile(r"^/api/programming/launch-vscode/[a-f0-9]{32}$"),
    re.compile(r"^/api/programming/extensions/(?:catalog|installed|install|upload|[A-Za-z0-9._-]+)$"),
    re.compile(r"^/api/w2m/vision/(?:status|download|analyze)$"),
    re.compile(r"^/api/downloads/[A-Za-z0-9._-]+$"),
    re.compile(r"^/api/speech/(?:status|transcribe|transcription/download|transcription|synthesize|voices/(?:ar|en)/download)$"),
    re.compile(r"^/api/motion/(?:open-editor|editor-project/[A-Za-z0-9_-]+|latest-project|open-saved/[A-Za-z0-9_-]+|audio-analysis/[A-Za-z0-9_-]+|repair-images/[A-Za-z0-9_-]+|update-editor)$"),
    re.compile(r"^/api/aedifex/scenes$"),
)
DEVICE_METHODS = {"GET", "POST", "PUT", "DELETE"}
LOCAL_ORIGIN = re.compile(r"^http://(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$", re.IGNORECASE)
services_start_process: subprocess.Popen[bytes] | None = None

app = FastAPI(title="AI TaskFlow Local Assistant", docs_url=None, redoc_url=None, openapi_url=None)
pairing_code = secrets.token_urlsafe(32)
pairing_started_at = time.monotonic()
pair_attempts: dict[str, list[float]] = {}
pairings: dict[str, dict[str, str]] = {}
pairings_lock = asyncio.Lock()
http_client = httpx.AsyncClient(
    timeout=httpx.Timeout(connect=8.0, read=None, write=None, pool=8.0),
    follow_redirects=False,
)


def _read_pairings() -> None:
    if not PAIRINGS_FILE.is_file():
        return
    try:
        value = json.loads(PAIRINGS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Could not read local assistant pairings: {exc}") from exc
    if not isinstance(value, dict):
        raise RuntimeError("The local assistant pairing file has an invalid format.")
    for token_hash, item in value.items():
        if not isinstance(token_hash, str) or not isinstance(item, dict):
            continue
        origin = item.get("origin")
        user_id = item.get("user_id")
        username = item.get("username")
        if isinstance(origin, str) and isinstance(user_id, str) and isinstance(username, str):
            pairings[token_hash] = {"origin": origin, "user_id": user_id, "username": username}


def _save_pairings() -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    temporary = PAIRINGS_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(pairings, separators=(",", ":")), encoding="utf-8")
    os.replace(temporary, PAIRINGS_FILE)


def _validate_origin(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme == "https"
        and parsed.hostname
        and not parsed.username
        and not parsed.password
        and parsed.path in {"", "/"}
        and not parsed.query
        and not parsed.fragment
    ):
        return f"https://{parsed.netloc}"
    if LOCAL_ORIGIN.fullmatch(value):
        return value.rstrip("/")
    raise HTTPException(status_code=400, detail="Use the HTTPS TaskFlow website address.")


def _is_device_route(path: str) -> bool:
    return any(pattern.fullmatch(path) for pattern in DEVICE_ROUTE_PATTERNS)


def _client_address(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _is_local_address(value: str) -> bool:
    try:
        return ipaddress.ip_address(value.split("%", 1)[0]).is_loopback
    except ValueError:
        return value.lower() == "localhost"


def _cors_headers(origin: str, methods: str = "GET, POST, PUT, DELETE, OPTIONS") -> dict[str, str]:
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": methods,
        "Access-Control-Allow-Headers": (
            "Authorization, Content-Type, X-TaskFlow-Cloud-Session, "
            "X-TaskFlow-Api-Origin, X-TaskFlow-Pairing-Code"
        ),
        "Access-Control-Allow-Private-Network": "true",
        "Access-Control-Max-Age": "300",
        "Cache-Control": "no-store",
        "Vary": "Origin",
    }


def _pairing_for_origin(origin: str) -> bool:
    return any(item["origin"] == origin for item in pairings.values())


@app.middleware("http")
async def local_origin_cors(request: Request, call_next):
    origin = request.headers.get("origin", "")
    client = _client_address(request)
    if not _is_local_address(client):
        return JSONResponse(status_code=403, content={"detail": "The local assistant only accepts loopback connections."})

    pairing_endpoint = request.url.path == "/pair"
    if origin and pairing_endpoint and request.method == "OPTIONS":
        try:
            _validate_origin(origin)
        except HTTPException:
            return JSONResponse(status_code=403, content={"detail": "Invalid TaskFlow origin."})
        return Response(status_code=204, headers=_cors_headers(origin, "POST, OPTIONS"))

    if origin and not _pairing_for_origin(origin):
        if not (pairing_endpoint and request.method == "POST"):
            return JSONResponse(status_code=403, content={"detail": "Pair this TaskFlow website with the local assistant first."})

    if request.method == "OPTIONS":
        if not origin or not _pairing_for_origin(origin):
            return JSONResponse(status_code=403, content={"detail": "Unpaired TaskFlow origin."})
        return Response(status_code=204, headers=_cors_headers(origin))

    response = await call_next(request)
    if origin and _pairing_for_origin(origin):
        for name, value in _cors_headers(origin).items():
            response.headers[name] = value
    elif origin and pairing_endpoint and request.method == "POST":
        for name, value in _cors_headers(origin, "POST, OPTIONS").items():
            response.headers[name] = value
    return response


def _cloud_session(request: Request) -> tuple[str, str]:
    cloud_token = request.headers.get("x-taskflow-cloud-session", "")
    api_origin = request.headers.get("x-taskflow-api-origin", "")
    if not cloud_token or len(cloud_token) > 4096:
        raise HTTPException(status_code=401, detail="Sign in to the hosted TaskFlow account first.")
    if not api_origin or api_origin != request.headers.get("origin", ""):
        raise HTTPException(status_code=403, detail="The TaskFlow API origin does not match the paired website.")
    return cloud_token, _validate_origin(api_origin)


async def _verify_cloud_user(api_origin: str, cloud_token: str) -> dict[str, Any]:
    try:
        response = await http_client.get(
            f"{api_origin}/api/auth/me",
            headers={"Authorization": f"Bearer {cloud_token}", "Accept": "application/json"},
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not verify the hosted TaskFlow session: {exc}") from exc
    if response.status_code in {401, 403}:
        raise HTTPException(status_code=401, detail="The hosted TaskFlow session is expired or not approved.")
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Hosted TaskFlow authentication failed ({response.status_code}).")
    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Hosted TaskFlow returned an invalid session response.") from exc
    user = payload.get("user") if isinstance(payload, dict) else None
    if not isinstance(user, dict):
        raise HTTPException(status_code=502, detail="Hosted TaskFlow returned no authenticated account.")
    user_id = user.get("id")
    username = user.get("username")
    role = user.get("role")
    status = user.get("status")
    if (
        not isinstance(user_id, str)
        or not re.fullmatch(r"[a-f0-9-]{32,36}", user_id)
        or not isinstance(username, str)
        or not username
        or role not in {"admin", "user"}
        or status != "approved"
    ):
        raise HTTPException(status_code=403, detail="Only an approved TaskFlow account can pair a local assistant.")
    return {
        "id": user_id,
        "username": username,
        "role": role,
        "status": status,
        "created_at": str(user.get("created_at", "")),
        "is_blocked": bool(user.get("is_blocked", False)),
        "block_note": str(user.get("block_note", "")),
    }


def _backend_url() -> str | None:
    ports = _runtime_ports()
    port = ports.get("api")
    if isinstance(port, int) and 1 <= port <= 65535:
        return f"http://127.0.0.1:{port}"
    return None


def _runtime_ports() -> dict[str, int]:
    runtime_file = APP_ROOT / "dist" / "taskflow-runtime.js"
    if runtime_file.is_file():
        try:
            runtime_text = runtime_file.read_text(encoding="utf-8")
        except OSError:
            return {}
        match = re.search(r"TASKFLOW_PORTS=Object\.freeze\((\{.*?\})\)", runtime_text)
        if match:
            try:
                ports = json.loads(match.group(1))
                if isinstance(ports, dict):
                    return {
                        key: value
                        for key, value in ports.items()
                        if key in {"api", "frontend", "engine2d", "engine3d"}
                        and isinstance(value, int)
                        and 1 <= value <= 65535
                    }
            except (json.JSONDecodeError, AttributeError, OSError):
                pass
    return {}


async def _find_backend() -> str | None:
    preferred = _backend_url()
    ports = [int(preferred.rsplit(":", 1)[1])] if preferred else []
    ports.extend(port for port in range(8000, 8100) if port not in ports)
    for port in ports:
        try:
            response = await http_client.get(f"http://127.0.0.1:{port}/health", timeout=0.4)
            if response.is_success:
                agent_health = await http_client.get(
                    f"http://127.0.0.1:{port}/api/local-agent/health",
                    timeout=0.4,
                )
                if agent_health.is_success and agent_health.json().get("enabled") is True:
                    return f"http://127.0.0.1:{port}"
                raise HTTPException(
                    status_code=503,
                    detail="Update and restart the local TaskFlow backend before using the hosted device assistant.",
                )
        except httpx.HTTPError:
            continue
    return None


async def _start_local_services() -> str:
    global services_start_process
    backend = await _find_backend()
    if backend:
        return backend
    if services_start_process is None or services_start_process.poll() is not None:
        launcher = APP_ROOT / "start-all.bat"
        if not launcher.is_file():
            raise HTTPException(status_code=503, detail="The local TaskFlow launcher was not found.")
        try:
            services_start_process = subprocess.Popen(
                ["cmd.exe", "/c", str(launcher)],
                cwd=APP_ROOT,
                stdin=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0),
            )
        except OSError as exc:
            raise HTTPException(status_code=503, detail=f"Could not start local TaskFlow services: {exc}") from exc
    for _ in range(120):
        await asyncio.sleep(1)
        backend = await _find_backend()
        if backend:
            return backend
        if services_start_process.poll() is not None:
            break
    raise HTTPException(
        status_code=503,
        detail="Local TaskFlow services did not start. Check the local TaskFlow console for setup errors.",
    )


def _local_agent_secret() -> bytes:
    values = dotenv_values(ENV_FILE)
    secret = values.get("TASKFLOW_LOCAL_AGENT_SECRET")
    if not isinstance(secret, str) or len(secret) < 32 or "GENERATE_RANDOM" in secret:
        raise RuntimeError(
            "TASKFLOW_LOCAL_AGENT_SECRET is missing. Run the updated initialize-backend.py, "
            "then restart the local TaskFlow backend."
        )
    return secret.encode("utf-8")


def _signed_identity_headers(
    user: dict[str, Any],
    method: str,
    path: str,
    query: str,
    body: bytes,
) -> dict[str, str]:
    timestamp = str(int(time.time()))
    claims = json.dumps(user, sort_keys=True, separators=(",", ":")).encode("utf-8")
    encoded_claims = base64.urlsafe_b64encode(claims).decode("ascii").rstrip("=")
    body_hash = hashlib.sha256(body).hexdigest()
    canonical = "\n".join((timestamp, method, path, query, body_hash, encoded_claims)).encode("utf-8")
    signature = hmac.new(_local_agent_secret(), canonical, hashlib.sha256).hexdigest()
    return {
        "X-TaskFlow-Agent-Timestamp": timestamp,
        "X-TaskFlow-Agent-User": encoded_claims,
        "X-TaskFlow-Agent-Body-SHA256": body_hash,
        "X-TaskFlow-Agent-Signature": signature,
    }


def _bearer(request: Request) -> str:
    value = request.headers.get("authorization", "")
    scheme, separator, token = value.partition(" ")
    if not separator or scheme.lower() != "bearer" or len(token) < 32 or len(token) > 256:
        raise HTTPException(status_code=401, detail="Pair this browser with the local assistant.")
    return token


def _load_pairing(request: Request) -> dict[str, str]:
    origin = request.headers.get("origin", "")
    token_hash = hashlib.sha256(_bearer(request).encode("utf-8")).hexdigest()
    pairing = pairings.get(token_hash)
    if not pairing or pairing["origin"] != origin:
        raise HTTPException(status_code=401, detail="The local assistant pairing is not valid for this website.")
    return pairing


@app.on_event("startup")
async def startup() -> None:
    result = subprocess.run(
        [sys.executable, str(APP_ROOT / "scripts" / "initialize-backend.py")],
        cwd=APP_ROOT,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Could not initialize the local TaskFlow agent secret: {result.stderr.strip()}")
    _read_pairings()
    _local_agent_secret()
    print(f"AI TaskFlow local assistant: http://{ASSISTANT_HOST}:{ASSISTANT_PORT}", flush=True)
    print(f"One-time pairing code (valid for 10 minutes): {pairing_code}", flush=True)
    print("Keep this window open while using the hosted TaskFlow device features.", flush=True)


@app.on_event("shutdown")
async def shutdown() -> None:
    await http_client.aclose()


@app.get("/health")
async def health(request: Request):
    pairing = _load_pairing(request)
    cloud_token, api_origin = _cloud_session(request)
    user = await _verify_cloud_user(api_origin, cloud_token)
    if user["id"] != pairing["user_id"]:
        raise HTTPException(status_code=403, detail="This local assistant is paired with another TaskFlow account.")
    return {"running": True, "paired": True, "username": user["username"]}


@app.post("/pair")
async def pair(request: Request):
    origin = _validate_origin(request.headers.get("origin", ""))
    address = _client_address(request)
    now = time.monotonic()
    recent = [item for item in pair_attempts.get(address, []) if now - item < 900]
    if len(recent) >= 5:
        raise HTTPException(status_code=429, detail="Too many pairing attempts. Wait 15 minutes and try again.")
    recent.append(now)
    pair_attempts[address] = recent

    supplied_code = request.headers.get("x-taskflow-pairing-code", "")
    if now - pairing_started_at > PAIR_CODE_TTL_SECONDS or not secrets.compare_digest(supplied_code, pairing_code):
        raise HTTPException(status_code=403, detail="The local assistant pairing code is invalid or expired.")

    cloud_token, api_origin = _cloud_session(request)
    if origin != api_origin:
        raise HTTPException(status_code=403, detail="The pairing request must use the hosted TaskFlow site's own origin.")
    user = await _verify_cloud_user(api_origin, cloud_token)
    await _start_local_services()
    local_ports = _runtime_ports()
    assistant_token = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(assistant_token.encode("utf-8")).hexdigest()
    async with pairings_lock:
        pairings[token_hash] = {
            "origin": origin,
            "user_id": user["id"],
            "username": user["username"],
        }
        _save_pairings()
    return {
        "paired": True,
        "assistant_token": assistant_token,
        "username": user["username"],
        "local_ports": local_ports,
    }


@app.delete("/pair", status_code=204)
async def unpair(request: Request):
    pairing = _load_pairing(request)
    cloud_token, api_origin = _cloud_session(request)
    user = await _verify_cloud_user(api_origin, cloud_token)
    if user["id"] != pairing["user_id"]:
        raise HTTPException(status_code=403, detail="This local assistant is paired with another TaskFlow account.")
    token_hash = hashlib.sha256(_bearer(request).encode("utf-8")).hexdigest()
    async with pairings_lock:
        pairings.pop(token_hash, None)
        _save_pairings()
    return Response(status_code=204)


@app.api_route("/proxy/{api_path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def proxy_device_api(api_path: str, request: Request):
    pairing = _load_pairing(request)
    cloud_token, api_origin = _cloud_session(request)
    user = await _verify_cloud_user(api_origin, cloud_token)
    if user["id"] != pairing["user_id"]:
        raise HTTPException(status_code=403, detail="This local assistant is paired with another TaskFlow account.")

    target_path = f"/{api_path}"
    if not _is_device_route(target_path) or request.method not in DEVICE_METHODS:
        raise HTTPException(status_code=404, detail="This device API route is not supported by the local assistant.")
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_REQUEST_BYTES:
                raise HTTPException(status_code=413, detail="The local assistant request exceeds the upload limit.")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="The request content length is invalid.") from exc
    body = await request.body()
    if len(body) > MAX_REQUEST_BYTES:
        raise HTTPException(status_code=413, detail="The local assistant request exceeds the upload limit.")

    backend = await _start_local_services()
    headers = {
        name: value
        for name, value in request.headers.items()
        if name.lower() in {"content-type", "accept", "range"}
    }
    headers.update(_signed_identity_headers(user, request.method, target_path, request.url.query, body))
    target_url = f"{backend}{target_path}"
    if request.url.query:
        target_url += f"?{request.url.query}"
    try:
        upstream_request = httpx.Request(request.method, target_url, headers=headers, content=body)
        upstream_response = await http_client.send(upstream_request, stream=True)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not call the local TaskFlow service: {exc}") from exc

    response_headers = {
        name: value
        for name, value in upstream_response.headers.items()
        if name.lower() in {
            "content-type", "content-length", "content-disposition", "cache-control",
            "last-modified", "etag", "accept-ranges",
        }
    }

    async def stream_response():
        try:
            async for chunk in upstream_response.aiter_raw():
                yield chunk
        finally:
            await upstream_response.aclose()

    return StreamingResponse(
        stream_response(),
        status_code=upstream_response.status_code,
        headers=response_headers,
        media_type=None,
    )


async def main() -> None:
    uvicorn_config = uvicorn.Config(
        app,
        host=ASSISTANT_HOST,
        port=ASSISTANT_PORT,
        log_level="info",
        access_log=False,
    )
    await uvicorn.Server(uvicorn_config).serve()


if __name__ == "__main__":
    asyncio.run(main())
