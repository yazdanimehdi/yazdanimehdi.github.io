"""Self-check for main.py. Run: python3 services/cv-render/test_main.py"""

import hashlib
import hmac
import io
import json
import os

os.environ["SESSION_SECRET"] = "s3cret"

import cvrender as cr
import main

KEY = hmac.new(b"s3cret", b"cv-render", hashlib.sha256).hexdigest()
STYLE = {"id": "c", "name": "C", "theme": "classic", "density": "compact", "design": {}}
BODY = {"cv": {"cv": {"name": "T"}}, "upload": None, "publications": [], "author": "", "style": STYLE, "themeFiles": {}}


def call(body, key=KEY, method="POST", path="/render", raw=None):
    data = raw if raw is not None else json.dumps(body).encode()
    env = {"REQUEST_METHOD": method, "PATH_INFO": path, "CONTENT_LENGTH": str(len(data)), "wsgi.input": io.BytesIO(data)}
    if key is not None:
        env["HTTP_X_CV_RENDER_KEY"] = key
    got = {}
    out = b"".join(main.app(env, lambda s, h: got.update(status=int(s.split()[0]), headers={k.lower(): v for k, v in h})))
    return got["status"], got["headers"], out


assert call(BODY, key="bad")[0] == 401, "wrong key"
assert call(BODY, key=None)[0] == 401, "missing key"
assert call(BODY, method="GET")[0] in (404, 405)
assert call(None, raw=b"x" * (4 * 1024 * 1024 + 1))[0] == 413, "oversize"
assert call(None, raw=b"not json")[0] == 400
assert call([1])[0] == 400, "body must be an object"
assert call({**BODY, "style": "x"})[0] == 400
assert call({**BODY, "themeFiles": {"a": 1}})[0] == 400
assert call(BODY, key="é\udcff")[0] == 401, "non-ASCII key is a 401, not a crash"
assert call({k: v for k, v in BODY.items() if k != "cv"})[0] == 400, "missing cv"
assert call({**BODY, "cv": "x"})[0] == 400
assert call({**BODY, "upload": "x"})[0] == 400

calls = []
real = cr.render_pdf
cr.render_pdf = lambda *a: calls.append(a) or b"%PDF-fake"
status, headers, out = call(BODY)
assert (status, headers["content-type"], out) == (200, "application/pdf", b"%PDF-fake")
assert len(calls[0]) == 1, "no theme files, plain render"
call({**BODY, "themeFiles": {"a.typ": "x"}})
assert calls[1][1:] == ({"a.typ": "x"}, "classic")
up = {"enabled": True, "content": "cv:\n  name: U\ndesign:\n  theme: mine\n"}
call({**BODY, "upload": up, "themeFiles": {"a.typ": "x"}})
assert calls[2][1:] == ({"a.typ": "x"}, "mine"), "an upload's own theme gets the files"


def boom(*a):
    raise cr.RenderError("bad margin")


cr.render_pdf = boom
status, headers, out = call(BODY)
assert status == 422 and json.loads(out) == {"error": "bad margin"}


def crash(*a):
    raise ValueError("secret internals")


cr.render_pdf = crash
status, _, out = call(BODY)
assert status == 500 and json.loads(out) == {"error": "render failed"}, out

cr.render_pdf = real
os.environ.pop("SESSION_SECRET")
assert call(BODY)[0] == 401, "no secret configured, always 401"
print("ok")
