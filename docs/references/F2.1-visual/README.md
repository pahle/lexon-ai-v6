# F2.1 visual review artifacts

[Full 82-image review gallery](./review/README.md) · [Current deviation table](./deviations.md) · [Capture manifest](./capture-manifest.json)

`index.json` is the canonical artifact map. It contains 10 immutable published reference PNGs, historical checkpoint evidence, and the current Task 9 review set: 19 views × desktop/mobile × light/dark, plus four expanded and two collapsed desktop sidebar header captures (82 review PNGs). Review paths are stable and overwritten in place. Capture options are Chromium, English locale, `Asia/Jakarta`, reduced motion, device scale factor 1, PNG, viewport only, hidden caret, and disabled screenshot animations. The view-specific viewport dimensions and source/applicability are in the index.

`approval.json` explicitly records `awaiting-owner`. This set is for review and is not an approved baseline. Capture-only GET response normalization is indexed in `index.json`: session rows set `createdAt` to `2026-11-04T11:02:00.000Z` and `expiresAt` to `2026-11-11T11:02:00.000Z`; active-team invitation rows set only `items[].expiresAt` to `2026-11-18T11:02:00.000Z`. These fields changed between repeated same-source captures. All IDs, `current`, channel, role, status, cursors, other response fields, and backend time remain unchanged. Behavior tests do not install these routes. The complete three-row Members and Invitations screenshot fixtures additionally use the explicit email orders in the index; they reject unexpected/partial pages, preserve the same real rows and all other fields, and leave product ordering and F1 pagination tests unchanged. See the deviation table for the repeated-capture evidence.

## Capture and comparison modes

The tracked approval status chooses `capture` when `awaiting-owner` and `compare` when `approved`, unless `LEXON_VISUAL_MODE` is explicitly set. `capture` writes only indexed `review/` images. `compare` requires recorded owner approval and fails on missing named baselines; it never captures as a fallback. `update` requires both an approved record and the explicit Playwright `--update-snapshots` flag. Capture runs do not use Playwright snapshot updating.

Capture the complete review set with both existing test selections, then write its manifest. The operator selection supplies the user-menu and provisioning views; the visual-review project supplies the other views. Each command starts its own required Compose stack.

```sh
LEXON_VISUAL_MODE=capture pnpm test:e2e --project visual-review
LEXON_VISUAL_MODE=capture pnpm test:e2e --project identity-browser -g 'F2 platform page passes both-theme axe checks in the real operator flow'
node scripts/test/visual-capture-manifest.mjs
```

After owner approval and Task 10 baseline promotion, comparisons use:

```sh
LEXON_VISUAL_MODE=compare pnpm test:e2e
```

The capture manifest and public acceptance notes record the actual capture host OS, Chromium version, source SHA, image hashes, and repeated-capture stability evidence. Do not infer Linux rendering from a Linux container when the browser itself runs on macOS.

Task 10 enables the explicit baseline maintenance command only after the owner has approved the exact image hashes and the approval record names that decision:

```sh
LEXON_VISUAL_MODE=update pnpm test:e2e --update-snapshots
```

Task 9 leaves approval awaiting-owner and creates no `baseline/` images.

The published review set is the final Linux artifact from source `a5c94b221a04f667740a4495011d2da8a12c7051`; all 82 hashes matched across two CI iterations. Main completed the full reference comparison. Formal Task 9 approval remains pending; no `baseline/` files have been promoted.
