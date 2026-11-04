# F2.1 visual review artifacts

`index.json` is the canonical artifact map. It contains 10 immutable published reference PNGs, historical checkpoint evidence, and the current Task 9 review set: 19 views × desktop/mobile × light/dark, plus four expanded and two collapsed desktop sidebar header captures (82 review PNGs). Review paths are stable and overwritten in place. Capture options are Chromium, English locale, `Asia/Jakarta`, reduced motion, device scale factor 1, PNG, viewport only, hidden caret, and disabled screenshot animations. The view-specific viewport dimensions and source/applicability are in the index.

`approval.json` explicitly records `awaiting-owner`. This set is for review and is not an approved baseline. The only initially permitted display normalization is session `expiresAt` from `GET /api/identity/sessions` to `2030-01-01T00:00:00.000Z`; IDs, `current`, channel, role, auth flags, and backend time are untouched. Behavior tests do not use the capture route.

## Capture and comparison modes

The tracked approval status chooses `capture` when `awaiting-owner` and `compare` when `approved`, unless `LEXON_VISUAL_MODE` is explicitly set. `capture` writes only indexed `review/` images. `compare` requires recorded owner approval and fails on missing named baselines; it never captures as a fallback. `update` requires both an approved record and the explicit Playwright `--update-snapshots` flag. Capture runs do not use Playwright snapshot updating.

Run the review set with:

```sh
LEXON_VISUAL_MODE=capture pnpm test:e2e -- --project visual-review
```

After owner approval, comparisons use:

```sh
LEXON_VISUAL_MODE=compare pnpm test:e2e -- --project visual-review
```

The task report records the actual capture host OS, Chromium version, source SHA, image hashes, and repeated-capture stability evidence. Do not infer Linux rendering from a Linux container when the browser itself runs on macOS.

The explicit baseline maintenance command is available only after the owner has approved the exact image hashes and the approval record names that decision:

```sh
LEXON_VISUAL_MODE=update pnpm test:e2e -- --project visual-review --update-snapshots
```

Task 9 leaves approval awaiting-owner and creates no `baseline/` images.
