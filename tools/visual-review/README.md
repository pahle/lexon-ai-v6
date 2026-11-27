# Visual review helpers (reviewer only)

The owner cannot read contact sheets: they are thumbnails. Build a local page
with crisp crops instead and open it with the browser preview tool.

## Pending-compare sheets (prototype | capture | diff)

```bash
RUN=<ci run id>; SHARD=<n>   # the shard whose pending.txt lists the ids
gh run download $RUN -R pahle/lexon-ai-v6 -n visual-pending-$RUN-shard-$SHARD -D /tmp/rv/s$SHARD
python3 tools/visual-review/pending_compare_page.py /tmp/rv/s$SHARD/pending-compare
cd /tmp/rv/s$SHARD/pending-compare && python3 -m http.server 8767 --bind 127.0.0.1
```

## Golden vs new capture (re-baseline review)

`golden_vs_capture_page.py <results.json> <shard root> <out dir> <git ref>`
copies each id's capture from the shard named in `captureShard`, the golden
from `<git ref>:docs/references/F4.1-visual/baseline/<id>.png`, and writes an
index.html that crops the region of interest at 2x.

## Lessons

- Every shard's `review/` folder holds a file for EVERY id; only the shard
  whose `pending.txt` lists the id has the real capture. The others hold
  checked-in bytes. Always select by `pending.txt` (PR #104 lesson).
- The prototype comparison README (`pending-compare/README.md`) has the gate
  result per id; read it before reading the implementer's summary.
