"""Golden (left) vs new capture (right), cropped at 2x, for re-baseline review.

usage: golden_vs_capture_page.py results.json shard_root out_dir git_ref
shard_root holds s1/ s2/ s3/ folders from the visual-pending artifacts.
Run from a checkout that has git_ref fetched.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

results, shard_root, out, ref = sys.argv[1:5]
out = Path(out)
(out / "old").mkdir(parents=True, exist_ok=True)
(out / "new").mkdir(parents=True, exist_ok=True)
data = json.loads(Path(results).read_text())
rows = data["results"] if isinstance(data, dict) else data
html = [
    "<html><head><meta charset=utf-8><style>body{font:14px system-ui;"
    "background:#ddd;margin:20px}.c{overflow:hidden;display:inline-block;"
    "border:1px solid #888;margin-right:16px;background:#fff;position:relative}"
    ".c img{position:absolute;transform-origin:0 0;max-width:none}</style>"
    "</head><body><h1>golden (left) vs new capture (right)</h1>"
]
for r in rows:
    rid = r["id"]
    shard = "".join(ch for ch in r.get("captureShard", "shard1") if ch.isdigit())
    src = Path(shard_root) / f"s{shard}" / "review" / f"{rid}.png"
    if not src.exists():
        html.append(f"<p>MISSING {rid}</p>")
        continue
    shutil.copy(src, out / "new" / f"{rid}.png")
    blob = subprocess.run(
        ["git", "show", f"{ref}:docs/references/F4.1-visual/baseline/{rid}.png"],
        capture_output=True,
    ).stdout
    (out / "old" / f"{rid}.png").write_bytes(blob)
    mobile = r["viewport"] == "mobile"
    x, y, w, h, z = (0, 0, 390, 844, 1) if mobile else (0, 0, 280, 560, 2)

    def cell(path: str) -> str:
        return (
            f'<div class=c style="width:{w * z}px;height:{h * z}px">'
            f'<img src="{path}" style="left:{-x * z}px;top:{-y * z}px;'
            f'transform:scale({z})"></div>'
        )

    html.append(
        f"<h3>{rid} · {r.get('percent')}%</h3>"
        + cell(f"old/{rid}.png")
        + cell(f"new/{rid}.png")
    )
(out / "index.html").write_text("\n".join(html) + "</body></html>")
print(len(rows), "rows")
