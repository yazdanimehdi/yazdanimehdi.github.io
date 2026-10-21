"""
Write design-schema.json for the admin's CV styles form: RenderCV's ClassicTheme design fields with `$ref`s resolved,
plus each other built-in theme's own defaults (`themeDefaults`). Run after upgrading RenderCV; the output is checked in.
"""

import json
from pathlib import Path

import rendercv
import yaml
from rendercv.schema.json_schema_generator import generate_json_schema

KEEP = ("type", "enum", "default", "description", "format")
OTHER_THEMES = Path(rendercv.__file__).parent / "schema/models/design/other_themes"


def resolve(node: dict, defs: dict) -> dict:
    """The fields the form needs; a TypstDimension becomes `format: dimension`, an anyOf its object variant."""
    out = {k: node[k] for k in KEEP if k in node}
    if "anyOf" in node:
        variants = [resolve(v, defs) for v in node["anyOf"]]
        out = {**next((v for v in variants if "properties" in v), variants[0]), **out}
    if "$ref" in node:
        name = node["$ref"].split("/")[-1]
        out = {**resolve(defs[name], defs), **out}
        if name == "TypstDimension":
            out["format"] = "dimension"
        # RenderCV takes any installed font; its enum lists only the bundled ones.
        if name.endswith("font_family__FontFamily"):
            out.pop("enum", None)
    if "properties" in node:
        out["properties"] = {k: resolve(v, defs) for k, v in node["properties"].items() if k != "templates"}
    if "items" in node:
        out["items"] = resolve(node["items"], defs)
    return out


def theme_defaults() -> dict:
    out = {}
    for path in sorted(OTHER_THEMES.glob("*.yaml")):
        design = yaml.safe_load(path.read_text(encoding="utf-8"))["design"]
        out[design.pop("theme")] = {k: v for k, v in design.items() if k != "templates"}
    return out


def main() -> None:
    defs = generate_json_schema()["$defs"]
    classic = resolve(defs["ClassicTheme"], defs)
    classic["properties"].pop("theme")
    schema = {"properties": classic["properties"], "themeDefaults": theme_defaults()}
    out = Path(__file__).with_name("design-schema.json")
    out.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
