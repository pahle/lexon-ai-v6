"""Write index.html next to pending-compare sheets, sorted by state."""
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
data = json.loads((root / "results.json").read_text())
rows = data["results"] if isinstance(data, dict) else data
rows = sorted(rows, key=lambda r: (r["id"], r["variant"]))
html = [
    "<html><head><meta charset=utf-8><style>body{font:14px system-ui;"
    "background:#ddd;margin:20px}img{display:block;max-width:none;"
    "border:1px solid #999;margin:4px 0 36px}</style></head><body>"
    "<h1>prototype | capture | diff</h1>"
]
for r in rows:
    html.append(
        f"<h3>{r['id']} · {r['key']} · {r['percent']}% {r['status']}</h3>"
        f"<img src='{r['sheet']}'>"
    )
(root / "index.html").write_text("\n".join(html) + "</body></html>")
print(len(rows), "sheets")
