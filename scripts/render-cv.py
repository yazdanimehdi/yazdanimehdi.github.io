#!/usr/bin/env python3
"""
Render CV PDF from config/cv.yml using RenderCV.

Reads the CMS-friendly cv.yml, converts to RenderCV's expected format,
runs rendercv to generate a PDF, copies the output to public/cv.pdf,
and writes metadata to src/data/cv.json.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "cv-render"))

from cvrender import build_input, build_rendercv_input, default_styles, render_pdf  # noqa: E402
CONFIG_PATH = ROOT / "config" / "cv.yml"
UPLOAD_PATH = ROOT / "config" / "cv-upload.yml"
OUTPUT_PDF = ROOT / "public" / "cv.pdf"
METADATA_PATH = ROOT / "src" / "data" / "cv.json"
PERSON_CV_DIR = ROOT / "cv"
PERSON_OUTPUT_DIR = ROOT / "public" / "cv"
PERSON_META_PATH = ROOT / "src" / "data" / "cv-people.json"
PUBLICATIONS_DIR = ROOT / "src" / "content" / "publications"
MAX_PDF_SIZE = 10 * 1024 * 1024  # 10 MB limit


def load_upload(path: Path = UPLOAD_PATH) -> tuple[str, dict] | None:
    """Load raw YAML upload if enabled and non-empty.

    Returns (raw_content_string, parsed_dict) so the renderer can write
    the original YAML verbatim (preserving section order and all entries).
    """
    if not path.exists():
        return None
    with open(path, "r") as f:
        data = yaml.safe_load(f)
    if not data or not data.get("enabled"):
        return None
    content = (data.get("content") or "").strip()
    if not content:
        return None
    parsed = yaml.safe_load(content)
    if not isinstance(parsed, dict) or "cv" not in parsed:
        print("WARNING: Uploaded YAML is missing 'cv' key, falling back to structured config")
        return None
    print("Using raw YAML from cv-upload.yml")
    return content, parsed


def load_config() -> dict:
    with open(CONFIG_PATH, "r") as f:
        return yaml.safe_load(f)


def snake_to_camel(name: str) -> str:
    """Convert snake_case to camelCase."""
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def convert_keys_to_camel(obj):
    """Recursively convert all dict keys from snake_case to camelCase."""
    if isinstance(obj, dict):
        return {snake_to_camel(k): convert_keys_to_camel(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [convert_keys_to_camel(item) for item in obj]
    return obj


def sync_upload_to_structured(uploaded: dict) -> None:
    """Convert uploaded RenderCV data back to CMS-friendly format and write to config/cv.yml.

    Also disables the upload in cv-upload.yml so the structured config takes over.
    """
    camel_data = convert_keys_to_camel(uploaded)

    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        yaml.dump(camel_data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    print(f"Synced upload to structured config at {CONFIG_PATH}")

    # Disable the upload so structured config takes over
    if UPLOAD_PATH.exists():
        with open(UPLOAD_PATH, "r") as f:
            upload_data = yaml.safe_load(f) or {}
        upload_data["enabled"] = False
        with open(UPLOAD_PATH, "w") as f:
            yaml.dump(upload_data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
        print("Disabled cv-upload.yml (enabled: false)")


def read_front_matter(path: Path) -> dict:
    match = re.match(r"^---\r?\n(.*?)\r?\n---", path.read_text(encoding="utf-8"), re.S)
    if not match:
        return {}
    try:
        data = yaml.safe_load(match.group(1))
    except yaml.YAMLError as e:
        print(f"WARNING: skipping {path.name}: {e}")
        return {}
    if data is not None and not isinstance(data, dict):
        print(f"WARNING: skipping {path.name}: front matter is not a mapping")
        return {}
    return data or {}


def collection_publications(directory: Path = PUBLICATIONS_DIR) -> list:
    """Front matter of every publication in the collection (build_rendercv_input turns it into entries)."""
    front_matters = [read_front_matter(path) for path in sorted([*directory.glob("*.md"), *directory.glob("*.mdx")])]
    return [data for data in front_matters if data.get("title")]


def render_cv(rendercv_input: dict | str, theme_files: dict | None = None, theme: str | None = None) -> Path:
    """Run RenderCV and return path to the generated PDF.

    rendercv_input can be a dict (YAML-dumped) or a raw YAML string
    (written verbatim to preserve section order).
    """
    if not isinstance(rendercv_input, str):
        rendercv_input = yaml.dump(rendercv_input, default_flow_style=False, allow_unicode=True, sort_keys=False)
    print("Running rendercv render...")
    stable_path = Path(tempfile.mktemp(suffix=".pdf"))
    stable_path.write_bytes(render_pdf(rendercv_input, theme_files, theme))
    return stable_path


def validate_pdf(pdf_path: Path) -> None:
    """Validate the generated PDF."""
    if not pdf_path.exists():
        raise RuntimeError("PDF file does not exist")

    size = pdf_path.stat().st_size
    if size == 0:
        raise RuntimeError("PDF file is empty")

    if size > MAX_PDF_SIZE:
        raise RuntimeError(
            f"PDF file is too large: {size / 1024 / 1024:.1f}MB (limit: {MAX_PDF_SIZE / 1024 / 1024:.0f}MB)"
        )

    print(f"PDF validated: {size / 1024:.1f} KB")


def write_metadata(pdf_size: int) -> None:
    """Write CV metadata JSON for the site to consume."""
    metadata = {
        "lastGenerated": datetime.now(timezone.utc).isoformat(),
        "pdfPath": "/cv.pdf",
        "pdfSize": pdf_size,
    }

    METADATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(METADATA_PATH, "w") as f:
        json.dump(metadata, f, indent=2)
        f.write("\n")

    print(f"Metadata written to {METADATA_PATH}")


def render_person_cvs() -> None:
    """Render per-person CV PDFs from cv/*.yml files."""
    if not PERSON_CV_DIR.exists():
        print("No per-person CV directory found, skipping.")
        return

    yml_files = sorted(PERSON_CV_DIR.glob("*.yml"))
    # Filter out .gitkeep and other non-CV files
    yml_files = [f for f in yml_files if f.stem != ".gitkeep"]

    if not yml_files:
        print("No per-person CV files found, skipping.")
        return

    PERSON_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    person_meta: dict = {}
    errors: list[str] = []

    for cv_file in yml_files:
        person_id = cv_file.stem
        print(f"\n--- Rendering CV for {person_id} ---")

        try:
            with open(cv_file, "r") as f:
                config = yaml.safe_load(f)

            if not config or not config.get("cv"):
                print(f"WARNING: {cv_file.name} is empty or missing 'cv' section, skipping.")
                continue

            rendercv_input = build_rendercv_input(config)
            pdf_path = render_cv(rendercv_input)
            validate_pdf(pdf_path)

            dest = PERSON_OUTPUT_DIR / f"{person_id}.pdf"
            shutil.copy2(pdf_path, dest)
            pdf_size = dest.stat().st_size
            pdf_path.unlink(missing_ok=True)

            person_meta[person_id] = {
                "lastGenerated": datetime.now(timezone.utc).isoformat(),
                "pdfPath": f"/cv/{person_id}.pdf",
                "pdfSize": pdf_size,
            }

            print(f"PDF written to {dest} ({pdf_size / 1024:.1f} KB)")

        except Exception as e:
            print(f"ERROR: Failed to render CV for {person_id}: {e}")
            errors.append(person_id)

    # Write per-person metadata
    PERSON_META_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(PERSON_META_PATH, "w") as f:
        json.dump(person_meta, f, indent=2)
        f.write("\n")

    print(f"\nPerson CV metadata written to {PERSON_META_PATH}")
    if errors:
        print(f"WARNING: Failed to render CVs for: {', '.join(errors)}")


def read_yaml(path: Path):
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        return None


def public_style(root: Path, cv_config: dict) -> dict:
    """The public style from config/cv-styles.yml; defaults when it is missing or garbled, the first style for an unknown id."""
    data = read_yaml(root / "config" / "cv-styles.yml")
    styles = [s for s in (data.get("styles") if isinstance(data, dict) else None) or [] if isinstance(s, dict) and s.get("theme")]
    if not styles:
        return default_styles(cv_config)["styles"][0]
    style = next((s for s in styles if s.get("id") == data.get("public")), styles[0])
    if isinstance(style.get("design"), str):  # Sveltia's code field saves YAML text
        style = {**style, "design": yaml.safe_load(style["design"]) or {}}
    return style


def main_input(root: Path) -> tuple[str, dict]:
    """(RenderCV YAML, custom theme files) for the public CV under `root`."""
    config_path = root / "config" / "cv.yml"
    if not config_path.exists():
        raise ValueError(f"CV config not found at {config_path}")
    config = read_yaml(config_path)
    if not config or not config.get("cv"):
        raise ValueError("CV config is empty or missing 'cv' section")
    style = public_style(root, config)
    upload = load_upload(root / "config" / "cv-upload.yml")
    site = read_yaml(root / "config" / "site.yml")
    text = build_input({
        "cv": config,
        "upload": {"enabled": True, "content": upload[0]} if upload else None,
        "publications": collection_publications(root / "src" / "content" / "publications"),
        "author": site.get("author") if isinstance(site, dict) else "",
        "style": style,
    })
    theme = yaml.safe_load(text).get("design", {}).get("theme")  # a raw upload may bring its own
    theme_dir = root / "cv" / "themes" / str(theme)
    theme_files = {}
    if re.fullmatch(r"[a-z0-9]+", str(theme)) and theme_dir.is_dir():
        base = theme_dir.resolve()
        for p in sorted(theme_dir.rglob("*.typ")):
            if p.is_file() and not p.is_symlink() and p.resolve().is_relative_to(base):
                theme_files[str(p.relative_to(theme_dir))] = p.read_text(encoding="utf-8")
    return text, theme_files


def main():
    upload_result = load_upload()
    try:
        rendercv_input, theme_files = main_input(ROOT)
    except ValueError as e:
        print(f"ERROR: {e}")
        sys.exit(1)
    if upload_result:
        sync_upload_to_structured(upload_result[1])

    # Render PDF
    try:
        pdf_path = render_cv(rendercv_input, theme_files, yaml.safe_load(rendercv_input)["design"]["theme"] if theme_files else None)
    except subprocess.TimeoutExpired:
        print("ERROR: RenderCV timed out after 120 seconds")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: Failed to render CV: {e}")
        sys.exit(1)

    # Validate
    try:
        validate_pdf(pdf_path)
    except RuntimeError as e:
        print(f"ERROR: PDF validation failed: {e}")
        pdf_path.unlink(missing_ok=True)
        sys.exit(1)

    # Copy to public/cv.pdf
    OUTPUT_PDF.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(pdf_path, OUTPUT_PDF)
    pdf_size = OUTPUT_PDF.stat().st_size
    print(f"PDF written to {OUTPUT_PDF}")

    # Clean up temp PDF
    pdf_path.unlink(missing_ok=True)

    # Write metadata
    write_metadata(pdf_size)

    print("\nCV render complete!")

    # Render per-person CVs
    render_person_cvs()


if __name__ == "__main__":
    main()
