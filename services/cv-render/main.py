"""Private CV render service (Vercel Services). POST /render -> application/pdf."""

import hashlib
import hmac
import json
import os
import sys
import traceback

import cvrender

MAX_BODY = 4 * 1024 * 1024


def reply(start_response, status, body, ctype="application/json"):
    if not isinstance(body, bytes):
        body = json.dumps(body).encode()
    start_response(status, [("Content-Type", ctype), ("Content-Length", str(len(body)))])
    return [body]


def authorized(environ) -> bool:
    secret = os.environ.get("SESSION_SECRET")
    if not secret:
        return False
    want = hmac.new(secret.encode(), b"cv-render", hashlib.sha256).hexdigest()
    return hmac.compare_digest(environ.get("HTTP_X_CV_RENDER_KEY", ""), want)


def app(environ, start_response):
    if not authorized(environ):
        return reply(start_response, "401 Unauthorized", {"error": "unauthorized"})
    if environ.get("REQUEST_METHOD") != "POST" or environ.get("PATH_INFO") != "/render":
        return reply(start_response, "404 Not Found", {"error": "not found"})
    try:
        length = int(environ.get("CONTENT_LENGTH") or 0)
    except ValueError:
        length = -1
    if length < 0 or length > MAX_BODY:
        return reply(start_response, "413 Payload Too Large", {"error": "body too large"})
    try:
        req = json.loads(environ["wsgi.input"].read(length))
    except ValueError:
        return reply(start_response, "400 Bad Request", {"error": "invalid JSON"})
    files = req.get("themeFiles") if isinstance(req, dict) else None
    if (
        not isinstance(req, dict)
        or not isinstance(req.get("style"), dict)
        or not (files is None or (isinstance(files, dict) and all(isinstance(v, str) for v in files.values())))
    ):
        return reply(start_response, "400 Bad Request", {"error": "invalid request"})
    try:
        yaml_text = cvrender.build_input(req)
        pdf = (
            cvrender.render_pdf(yaml_text, files, req["style"].get("theme"))
            if files
            else cvrender.render_pdf(yaml_text)
        )
    except cvrender.RenderError as e:
        return reply(start_response, "422 Unprocessable Entity", {"error": str(e)})
    except Exception:
        traceback.print_exc(file=sys.stderr)
        return reply(start_response, "500 Internal Server Error", {"error": "render failed"})
    return reply(start_response, "200 OK", pdf, "application/pdf")
