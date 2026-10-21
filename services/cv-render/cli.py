"""Render a CV from the service's JSON request on stdin; PDF on stdout. Exit 2 with the error on stderr."""

import json
import sys

import cvrender


def main() -> int:
    try:
        req = json.load(sys.stdin)
        files = req.get("themeFiles")
        yaml_text = cvrender.build_input(req)
        pdf = (
            cvrender.render_pdf(yaml_text, files, cvrender.design_theme(yaml_text))
            if files
            else cvrender.render_pdf(yaml_text)
        )
    except (cvrender.RenderError, ValueError, KeyError, AttributeError, TypeError) as e:
        print(e, file=sys.stderr)
        return 2
    sys.stdout.buffer.write(pdf)
    return 0


if __name__ == "__main__":
    sys.exit(main())
