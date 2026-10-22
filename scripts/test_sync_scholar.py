"""Self-check for sync-scholar.py's merge. Run: python3 scripts/test_sync_scholar.py"""

import importlib.util
import sys
import types
from pathlib import Path

# scholarly is only needed to fetch; CI doesn't install it.
if importlib.util.find_spec("scholarly") is None:
    sys.modules["scholarly"] = types.SimpleNamespace(scholarly=None)

spec = importlib.util.spec_from_file_location("sync_scholar", Path(__file__).with_name("sync-scholar.py"))
ss = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ss)

existing = [
    {"id": "p1", "title": "MIRAGE: Measuring", "authors": ["Mehdi Yazdani-Jahromi"], "venue": "arXiv", "year": 2026, "abstract": "full"},
    {"id": "cms", "title": "Only in the CMS", "authors": ["A"], "venue": "V", "year": 2020},
]
new = [
    {"id": "p1", "title": "Mirage: measuring", "authors": ["M Yazdani-Jahromi"], "venue": "arXiv preprint", "year": 2026, "url": "https://scholar.google.com/x"},
    {"id": "p2", "title": "Brand new", "authors": ["B"], "venue": "W", "year": 2025},
]
merged = {m["id"]: m for m in ss.merge_with_existing(new, existing)}
m = merged["p1"]
assert m["authors"] == ["Mehdi Yazdani-Jahromi"] and m["title"] == "MIRAGE: Measuring" and m["venue"] == "arXiv", m
assert m["abstract"] == "full", m
assert m["url"] == "https://scholar.google.com/x", "empty before: filled"
assert merged["p2"]["title"] == "Brand new", "new papers are added"
assert merged["cms"]["title"] == "Only in the CMS", "CMS-only papers are kept"
from datetime import date

mon, tue, sun, first = date(2026, 10, 19), date(2026, 10, 20), date(2026, 10, 18), date(2026, 11, 1)
assert ss.papers_due(None, tue) and ss.papers_due({"every": "day"}, tue)
assert not ss.papers_due({"every": "off"}, mon)
assert ss.papers_due({"every": "week", "weekday": 1}, mon) and not ss.papers_due({"every": "week", "weekday": 1}, tue)
assert ss.papers_due({"every": "week", "weekday": 0}, sun), "0 is Sunday"
assert ss.papers_due({"every": "week"}, mon), "weekday defaults to Monday"
assert ss.papers_due({"every": "month", "monthday": 1}, first) and not ss.papers_due({"every": "month", "monthday": 1}, tue)
print("sync-scholar self-check passed")
