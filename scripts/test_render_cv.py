"""Self-check for render-cv.py's pure helpers. Run: python3 scripts/test_render_cv.py"""

import importlib.util
import sys
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("render_cv", Path(__file__).with_name("render-cv.py"))
rc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rc)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "services" / "cv-render"))
import cvrender as cr  # noqa: E402

sections = {
    "education": [{"institution": "A", "visible": False}, {"institution": "B", "visible": True}],
    "summary": ["text"],
}
assert cr.drop_hidden(sections) == {"education": [{"institution": "B"}], "summary": ["text"]}, cr.drop_hidden(sections)

with tempfile.TemporaryDirectory() as d:
    Path(d, "a.md").write_text("---\ntitle: Old\nauthors: [X]\nvenue: V\nyear: 2020\n---\nbody\n")
    Path(d, "b.md").write_text("---\ntitle: New\nauthors: [Y, Z]\nvenue: W\nyear: 2024\ndoi: 10.1/x\n---\n")
    Path(d, "c.md").write_text("no front matter\n")
    pubs = cr.publication_entries(rc.collection_publications(Path(d)))
    assert [p["title"] for p in pubs] == ["New", "Old"], pubs
    assert pubs[0] == {"title": "New", "authors": ["Y", "Z"], "journal": "W", "date": "2024", "doi": "10.1/x"}, pubs[0]

hidden_only = {"cv": {"name": "N", "sections": {"experience": [{"company": "C", "position": "P", "visible": False}]}}}
collection = [{"title": "T", "authors": ["A"], "year": 2024}]
out = cr.build_rendercv_input(hidden_only, collection)
assert "experience" not in out["cv"]["sections"], out
assert out["cv"]["sections"]["publications"], "filled from the publications collection"

own_pubs = {"cv": {"name": "N", "sections": {"selected": [{"title": "T", "authors": ["A"]}]}}}
assert "publications" not in cr.build_rendercv_input(own_pubs, collection)["cv"]["sections"]
assert "publications" not in cr.build_rendercv_input(hidden_only)["cv"]["sections"], "per-person CVs stay as written"

# Malformed or non-mapping front matter is skipped with a warning; backups are not publications.
with tempfile.TemporaryDirectory() as d:
    Path(d, "good.md").write_text("---\ntitle: Good\nauthors: [A]\n---\n")
    Path(d, "bad.md").write_text("---\ntitle: [unclosed\n---\n")
    Path(d, "list.md").write_text("---\n- a\n- b\n---\n")
    Path(d, "good.md.bak").write_text("---\ntitle: Backup\nauthors: [A]\n---\n")
    Path(d, "mdx.mdx").write_text("---\ntitle: Mdx\nauthors: [A]\n---\n")
    assert sorted(p["title"] for p in rc.collection_publications(Path(d))) == ["Good", "Mdx"]

# A CV whose own publications are all hidden keeps them hidden instead of showing the collection.
all_hidden = {"cv": {"name": "N", "sections": {"selected": [{"title": "T", "authors": ["A"], "visible": False}]}}}
assert "publications" not in cr.build_rendercv_input(all_hidden, collection)["cv"]["sections"]
with_pdf = {"cv": {"name": "N", "sections": {}}, "pdf": {"pageSize": "A4"}}
assert "pdf" not in cr.build_rendercv_input(with_pdf), "the JS renderer's page size never reaches RenderCV"
strip = cr.strip_site_markup
assert strip("[**Rust** code]{.mono} and [GitHub](https://g.com/x)") == "**Rust** code and [GitHub](https://g.com/x)"
assert strip("a**** b \\**** c") == "a b \\**** c", "empty bold goes; an escaped star stays"
assert strip("**bold** *it* \\*") == "**bold** *it* \\*"
fonts = {"cv": {"name": "N", "sections": {"skills": [{"label": "[Rust]{.serif}", "details": "[x]{.sans}"}]}}}
assert cr.build_rendercv_input(fonts)["cv"]["sections"]["skills"] == [{"label": "Rust", "details": "x"}]
# main_input builds the public style's input from a root: harvard + compact; custom themes are read from disk.
import yaml  # noqa: E402

with tempfile.TemporaryDirectory() as d:
    root = Path(d)
    (root / "config").mkdir()
    (root / "src" / "content" / "publications").mkdir(parents=True)
    (root / "config" / "cv.yml").write_text("cv:\n  name: N\n  sections: {}\n")
    (root / "config" / "site.yml").write_text("author: 'N'\n")
    (root / "config" / "cv-styles.yml").write_text(
        "public: h\nstyles:\n  - {id: h, name: H, theme: harvard, density: compact, design: {}}\n"
    )
    text, theme_files = rc.main_input(root)
    design = yaml.safe_load(text)["design"]
    assert design["theme"] == "harvard" and design["page"]["top_margin"] == "1.2cm", design
    assert theme_files == {}, theme_files
    # A missing public id falls back to the first style; a custom theme's files come from cv/themes/<theme>/.
    (root / "cv" / "themes" / "mine").mkdir(parents=True)
    (root / "cv" / "themes" / "mine" / "Preamble.j2.typ").write_text("x")
    (root / "cv" / "themes" / "mine" / "notes.txt").write_text("skip")
    (root / "config" / "cv-styles.yml").write_text(
        "public: gone\nstyles:\n  - {id: m, name: M, theme: mine, density: normal, design: {}}\n"
    )
    text, theme_files = rc.main_input(root)
    assert yaml.safe_load(text)["design"]["theme"] == "mine" and theme_files == {"Preamble.j2.typ": "x"}, theme_files
    # Garbled styles file: defaults.
    (root / "config" / "cv-styles.yml").write_text(": [\n")
    assert yaml.safe_load(rc.main_input(root)[0])["design"]["theme"] == "classic"
    # A theme name that is a path never touches disk; symlinked theme files are skipped.
    (root / "config" / "cv-styles.yml").write_text(
        "styles:\n  - {id: x, name: X, theme: '../..', density: normal}\n"
    )
    assert rc.main_input(root)[1] == {}
    (root / "outside.typ").write_text("secret")
    (root / "cv" / "themes" / "mine" / "link.typ").symlink_to(root / "outside.typ")
    (root / "config" / "cv-styles.yml").write_text("styles:\n  - {id: m, name: M, theme: mine, density: normal}\n")
    assert rc.main_input(root)[1] == {"Preamble.j2.typ": "x"}
print("render-cv self-check passed")
