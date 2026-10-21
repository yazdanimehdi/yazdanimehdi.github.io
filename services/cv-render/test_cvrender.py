"""Self-check for cvrender. Run: python3 services/cv-render/test_cvrender.py"""

import json
from pathlib import Path

import yaml

import cvrender as cr

HERE = Path(__file__).parent

for case in json.loads((HERE / "fixtures" / "default-styles.json").read_text()):
    got = cr.default_styles(case["input"])
    assert got == case["expected"], got

d = cr.resolve_design({"theme": "classic", "density": "compact", "design": {"page": {"top_margin": "9mm"}}})
assert d["theme"] == "classic"
assert d["page"]["top_margin"] == "9mm", "the override beats the preset"
assert d["page"]["left_margin"] == "1.4cm", "the preset stays"
assert d["typography"]["font_size"]["body"] == "9.5pt", "deep merge"
assert cr.resolve_design({"theme": "classic", "density": "bogus", "design": {}}) == {"theme": "classic"}, "unknown density is normal"

pub = {"title": "T", "authors": ["A. B", "Jane  Smith", "**Jane Smith**"]}
assert cr.bold_author([pub], "Jane Smith")[0]["authors"] == ["A. B", "**Jane  Smith**", "**Jane Smith**"]
assert cr.bold_author([pub], "")[0]["authors"] == pub["authors"], "no author, no bolding"

style = {"id": "c", "name": "C", "theme": "classic", "density": "compact", "design": {}}
req = {"cv": {"cv": {"name": "X"}}, "publications": [], "author": "", "style": style}
up = {"enabled": True, "content": "cv:\n  name: X\ndesign:\n  theme: ink\n"}
assert yaml.safe_load(cr.build_input({**req, "upload": up}))["design"] == {"theme": "ink"}, "the upload's own design wins"
out = yaml.safe_load(cr.build_input({**req, "upload": {"enabled": True, "content": "cv:\n  name: X\n"}}))
assert out["design"]["theme"] == "classic" and out["design"]["page"]["top_margin"] == "1.2cm"
out = yaml.safe_load(cr.build_input({**req, "upload": None}))
assert out["cv"]["name"] == "X" and out["design"]["page"]["top_margin"] == "1.2cm", out
off = yaml.safe_load(cr.build_input({**req, "upload": {"enabled": False, "content": "cv:\n  name: Z\n"}}))
assert off["cv"]["name"] == "X", "a disabled upload is ignored"

# The cv.yml design is ignored once a style is passed; collection publications fill in only when the CV has none.
pubs = [{"title": "Old", "authors": ["Jane Smith"], "venue": "V", "year": 2020}, {"title": "New", "authors": ["Jane Smith"], "year": 2024}]
cv = {"cv": {"name": "X", "sections": {}}, "design": {"theme": "ink"}}
out = yaml.safe_load(cr.build_input({**req, "cv": cv, "publications": pubs, "author": "Jane Smith", "upload": None}))
assert out["design"]["theme"] == "classic"
assert [p["title"] for p in out["cv"]["sections"]["publications"]] == ["New", "Old"]
assert out["cv"]["sections"]["publications"][0]["authors"] == ["**Jane Smith**"]
own = {"cv": {"name": "X", "sections": {"selected": [{"title": "T", "authors": ["A"]}]}}}
out = yaml.safe_load(cr.build_input({**req, "cv": own, "publications": pubs, "upload": None}))
assert "publications" not in out["cv"]["sections"]

# Bolding reaches publications in a raw upload too.
raw = "cv:\n  name: X\n  sections:\n    pubs:\n      - title: T\n        authors: [Jane Smith]\n"
out = yaml.safe_load(cr.build_input({**req, "author": "Jane Smith", "upload": {"enabled": True, "content": raw}}))
assert out["cv"]["sections"]["pubs"][0]["authors"] == ["**Jane Smith**"]

fonts = {"cv": {"name": "N", "sections": {"skills": [{"label": "[x]{.mono}", "details": "d"}]}}}
out = yaml.safe_load(cr.build_input({**req, "cv": fonts, "upload": None}))
assert out["cv"]["sections"]["skills"][0]["label"] == "x"

pdf = cr.render_pdf(cr.build_input({**req, "upload": None}))
assert pdf.startswith(b"%PDF"), "renders a real PDF"
try:
    cr.render_pdf(cr.build_input({**req, "upload": None, "style": {**style, "design": {"page": {"top_margin": "abc"}}}}))
    raise SystemExit("bad design value should fail")
except cr.RenderError as e:
    assert "top_margin" in str(e), e

def fails(fn):
    try:
        fn()
    except cr.RenderError:
        return True
    return False


assert fails(lambda: cr.build_input({**req, "upload": {"enabled": True, "content": "cv: [unclosed"}})), "bad upload YAML"
for bad in ["../x.j2.typ", "/abs.typ", "a//b.typ", "a/../b.typ"]:
    assert fails(lambda: cr.render_pdf("cv: {}", {bad: "x"}, "mine")), bad
assert fails(lambda: cr.render_pdf("cv: {}", {"a.typ": "x"})), "theme_files need a theme"
assert fails(lambda: cr.render_pdf("cv: {}", {"a.typ": "x"}, "../x")), "theme must be [a-z0-9]+"
assert fails(lambda: cr.render_pdf("cv: {}", {"a.typ": "x"}, "My_Theme")), "theme must be [a-z0-9]+"
before = json.dumps(cr.PRESETS, sort_keys=True)
cr.resolve_design(style)["page"]["top_margin"] = "changed"
assert json.dumps(cr.PRESETS, sort_keys=True) == before, "resolve_design must not share dicts with PRESETS"
print("cvrender self-check passed")
