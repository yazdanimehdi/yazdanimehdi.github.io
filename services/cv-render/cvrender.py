"""
Shared CV renderer: site CV data plus a style become RenderCV input, and RenderCV turns it into a PDF.

Used by scripts/render-cv.py (GitHub Actions) and by the private Python service (api/).
"""

import copy
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

PRESETS = json.loads((Path(__file__).with_name("presets.json")).read_text(encoding="utf-8"))
PAGE_SIZES = {"A4": "a4", "LETTER": "us-letter"}


class RenderError(Exception):
    """RenderCV rejected the input or failed; the message is its own stderr or validation text."""


def camel_to_snake(name: str) -> str:
    """Convert camelCase to snake_case."""
    s1 = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def convert_keys(obj):
    """Recursively convert all dict keys from camelCase to snake_case."""
    if isinstance(obj, dict):
        return {camel_to_snake(k): convert_keys(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [convert_keys(item) for item in obj]
    return obj


def transform_section_entries(sections: dict) -> dict:
    """Transform our CV section format to RenderCV entry types."""
    result = {}

    for section_name, entries in sections.items():
        if not entries:
            continue

        if section_name == "education":
            result[section_name] = [
                transform_education_entry(e) for e in entries
            ]
        elif section_name == "experience":
            result[section_name] = [
                transform_experience_entry(e) for e in entries
            ]
        elif section_name == "publications":
            result[section_name] = [
                transform_publication_entry(e) for e in entries
            ]
        elif section_name == "awards":
            result[section_name] = [
                transform_one_line_entry(e) for e in entries
            ]
        elif section_name == "skills":
            result[section_name] = [
                transform_one_line_entry(e) for e in entries
            ]
        else:
            # Pass through unknown sections as-is
            print(f"INFO: Passing through unknown section '{section_name}' ({len(entries)} entries)")
            result[section_name] = entries

    return result


def transform_education_entry(entry: dict) -> dict:
    """Map education entry to RenderCV EducationEntry."""
    result = {
        "institution": entry.get("institution", ""),
        "area": entry.get("area", ""),
        "degree": entry.get("degree", ""),
    }
    if entry.get("location"):
        result["location"] = entry["location"]
    if entry.get("start_date"):
        result["start_date"] = entry["start_date"]
    if entry.get("end_date"):
        result["end_date"] = entry["end_date"]
    highlights = entry.get("highlights", [])
    if highlights:
        result["highlights"] = highlights
    return result


def transform_experience_entry(entry: dict) -> dict:
    """Map experience entry to RenderCV ExperienceEntry."""
    result = {
        "company": entry.get("company", ""),
        "position": entry.get("position", ""),
    }
    if entry.get("location"):
        result["location"] = entry["location"]
    if entry.get("start_date"):
        result["start_date"] = entry["start_date"]
    if entry.get("end_date"):
        result["end_date"] = entry["end_date"]
    highlights = entry.get("highlights", [])
    if highlights:
        result["highlights"] = highlights
    return result


def transform_publication_entry(entry: dict) -> dict:
    """Map publication entry to RenderCV PublicationEntry."""
    result = {
        "title": entry.get("title", ""),
        "authors": entry.get("authors", []),
    }
    if entry.get("journal"):
        result["journal"] = entry["journal"]
    if entry.get("date"):
        result["date"] = str(entry["date"])
    if entry.get("doi"):
        result["doi"] = entry["doi"]
    if entry.get("url"):
        result["url"] = entry["url"]
    return result


def transform_one_line_entry(entry: dict) -> dict:
    """Map award/skill entry to RenderCV OneLineEntry."""
    return {
        "label": entry.get("label", ""),
        "details": entry.get("details", ""),
    }


def drop_hidden(sections: dict) -> dict:
    """Remove entries marked visible: false and strip the key from the rest (RenderCV rejects unknown keys)."""
    result = {}
    for name, entries in (sections or {}).items():
        if not isinstance(entries, list):
            result[name] = entries
            continue
        kept = []
        for entry in entries:
            if isinstance(entry, dict):
                if entry.get("visible") is False:
                    continue
                entry = {k: v for k, v in entry.items() if k != "visible"}
            kept.append(entry)
        result[name] = kept
    return result


def is_publication(entry) -> bool:
    return isinstance(entry, dict) and "title" in entry and "authors" in entry


def publication_entries(front_matters: list) -> list:
    """RenderCV publication entries built from publication front matter, newest first."""
    entries = []
    for data in front_matters:
        if not data.get("title"):
            continue
        entry = {"title": data["title"], "authors": data.get("authors") or []}
        if data.get("venue"):
            entry["journal"] = data["venue"]
        if data.get("year"):
            entry["date"] = str(data["year"])
        if data.get("doi"):
            entry["doi"] = data["doi"]
        if data.get("url"):
            entry["url"] = data["url"]
        entries.append(entry)
    return sorted(entries, key=lambda e: e.get("date", ""), reverse=True)


FONT_SPAN = re.compile(r"\[([^\]]*)\]\{\.[A-Za-z]+\}")
EMPTY_BOLD = re.compile(r"(?<![*\\])\*{4}(?!\*)")


def strip_site_markup(value):
    """Markup only the site and the built-in PDF understand: `[text]{.mono}` becomes `text` (its `**`/`*` and
    `[link](url)` stay for RenderCV), and an empty `****` goes. Strings, lists and mappings, recursively."""
    if isinstance(value, str):
        return EMPTY_BOLD.sub("", FONT_SPAN.sub(r"\1", value))
    if isinstance(value, list):
        return [strip_site_markup(v) for v in value]
    if isinstance(value, dict):
        return {k: strip_site_markup(v) for k, v in value.items()}
    return value


def build_rendercv_input(config: dict, publications: list[dict] | None = None) -> dict:
    """Convert our cv.yml format to RenderCV's expected YAML input.

    publications: publication front matter (title, authors, venue, year, doi, url). When no section lists
    publications, they become a section (the collection is the single source of publications for the site CV).
    """
    # Convert all keys from camelCase to snake_case
    converted = convert_keys(config)

    cv = converted.get("cv", {})
    written = cv.pop("sections", {}) or {}
    # Decided before hiding: a CV that lists its own publications (even all hidden) never gets the collection.
    has_own_publications = any(
        isinstance(entries, list) and entries and is_publication(entries[0]) for entries in written.values()
    )
    sections_raw = drop_hidden(written)

    if publications and not has_own_publications:
        entries = publication_entries(publications)
        if entries:
            sections_raw["publications"] = entries

    # Transform section entries to proper RenderCV types
    cv["sections"] = transform_section_entries(sections_raw)

    result = {"cv": cv}

    # Include design settings if present
    design = converted.get("design")
    if design:
        result["design"] = design

    return strip_site_markup(result)


def default_styles(cv_config: dict) -> dict:
    """The styles to start from when config/cv-styles.yml is missing: compact, or the cv.yml design kept as is."""
    # Import YAML and the Actions upload sync store design keys camelCase; RenderCV's are snake_case.
    design = convert_keys(dict(cv_config.get("design") or {}))
    theme = design.pop("theme", None) or "classic"
    size = PAGE_SIZES.get(((cv_config.get("pdf") or {}).get("pageSize") or "").upper())
    if size:
        design["page"] = {"size": size, **design.get("page", {})}
    if (cv_config.get("design") or {}).keys() - {"theme"}:
        style = {"id": "my-style", "name": "My style", "theme": theme, "density": "normal", "design": design}
    else:
        style = {"id": "compact", "name": "Compact", "theme": theme, "density": "compact", "design": design}
    return {"public": style["id"], "styles": [style]}


def deep_merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for key, value in over.items():
        out[key] = deep_merge(out[key], value) if isinstance(value, dict) and isinstance(out.get(key), dict) else copy.deepcopy(value)
    return out


def resolve_design(style: dict) -> dict:
    """The final RenderCV design block: the density preset, then the style's own overrides, with its theme."""
    preset = PRESETS.get(style.get("density"), PRESETS["normal"])
    return {**deep_merge(preset, style.get("design") or {}), "theme": style["theme"]}


def bold_author(entries: list[dict], author: str) -> list[dict]:
    """Bold `author` in each entry's authors list (whitespace-insensitive); already-bold names stay as they are."""
    target = " ".join(author.split())
    if not target:
        return entries
    return [
        {**e, "authors": [f"**{a}**" if isinstance(a, str) and " ".join(a.split()) == target else a for a in e["authors"]]}
        if isinstance(e.get("authors"), list) else e
        for e in entries
    ]


def bold_publications(sections: dict, author: str) -> dict:
    return {
        name: bold_author(entries, author) if isinstance(entries, list) and entries and is_publication(entries[0]) else entries
        for name, entries in sections.items()
    }


def build_input(req: dict) -> str:
    """The final RenderCV YAML for a request: cv, upload, publications, author and style (see the service's API)."""
    style, upload, author = req["style"], req.get("upload"), req.get("author") or ""
    content = ((upload or {}).get("content") or "").strip() if (upload or {}).get("enabled") else ""
    try:
        parsed = yaml.safe_load(strip_site_markup(content)) if content else None
    except yaml.YAMLError as e:
        raise RenderError(f"The uploaded CV is not valid YAML: {e}") from e
    if isinstance(parsed, dict) and "cv" in parsed:
        # A raw upload keeps its own design; otherwise the style's applies.
        result = parsed
        result.setdefault("design", resolve_design(style))
    else:
        result = build_rendercv_input(req["cv"], req.get("publications"))
        result["design"] = resolve_design(style)
    sections = (result.get("cv") or {}).get("sections")
    if author and isinstance(sections, dict):
        result["cv"]["sections"] = bold_publications(sections, author)
    return yaml.dump(result, default_flow_style=False, allow_unicode=True, sort_keys=False)


def design_theme(yaml_text: str) -> str | None:
    """The theme of built RenderCV input: the style's, or a raw upload's own (its custom theme files go there)."""
    return ((yaml.safe_load(yaml_text) or {}).get("design") or {}).get("theme")


def child_env() -> dict[str, str]:
    """RenderCV's whole environment: no project secrets (theme templates run unsandboxed). HOME and XDG_CACHE_HOME
    point at one stable dir under the system temp dir (the only writable place on Vercel), so a warm instance reuses
    Typst's package cache (RenderCV's library downloads @preview/fontawesome on first use)."""
    cache = Path(tempfile.gettempdir()) / "cv-render-cache"
    cache.mkdir(exist_ok=True)
    return {
        "PATH": os.environ.get("PATH", os.defpath),
        "PYTHONPATH": os.pathsep.join(p for p in sys.path if p),
        "HOME": str(cache),
        "XDG_CACHE_HOME": str(cache),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
    }


def render_pdf(yaml_text: str, theme_files: dict[str, str] | None = None, theme: str | None = None) -> bytes:
    """Run RenderCV on `yaml_text` and return the PDF. Custom theme files are written under `<tmp>/<theme>/`."""
    if theme_files and not theme:
        raise RenderError("theme is required with theme_files")
    for rel in theme_files or {}:
        if rel.startswith("/") or any(part in ("", "..") for part in rel.split("/")):
            raise RenderError(f"Invalid theme file path: {rel!r}")
    if theme and not re.fullmatch(r"[a-z0-9]+", theme):
        raise RenderError(f"Invalid theme name: {theme!r}")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "cv.yaml").write_text(yaml_text, encoding="utf-8")
        for rel, text in (theme_files or {}).items():
            path = root / theme / rel
            if not path.resolve().is_relative_to((root / theme).resolve()):
                raise RenderError(f"Invalid theme file path: {rel!r}")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")

        try:
            result = subprocess.run(
                # Not --quiet (it hides the validation table) nor --dont-generate-typst (it implicitly disables the PDF).
                [sys.executable, "-m", "rendercv", "render", "cv.yaml",
                 "--dont-generate-markdown", "--dont-generate-html", "--dont-generate-png"],
                capture_output=True,
                text=True,
                cwd=tmp,
                timeout=120,
                env=child_env(),
            )
        except subprocess.TimeoutExpired as e:
            raise RenderError("RenderCV timed out after 120 seconds") from e
        except OSError as e:
            raise RenderError(f"Could not start RenderCV: {e}") from e
        if result.returncode != 0:
            raise RenderError(result.stderr or result.stdout)

        pdf = next(root.rglob("*.pdf"), None)
        if pdf is None:
            raise RenderError("RenderCV did not produce a PDF file")
        return pdf.read_bytes()
