# Task 14 informal thread preview

Captured through local Linux Compose/Caddy with the scripted model at source
`7707b45`; PNG, deviceScaleFactor 1. Stable files overwrite in place.
This is not Task 19 formal visual approval.

Main session rendered the preview independently (1/1 browser test passed) and
visually compared new-chat frames with `prototype/01-new-chat.png`, completed
light/dark answer frames with `prototype/06-answer-complete.png` and
`prototype/21-answer-dark.png`, and expanded summary with
`prototype/05-reasoning-open.png`. Token/component sizes follow base-nova;
synthetic content and timing differ. No raw reasoning or real model call.

The old Home/Conversations sidebar and generic Home/Chat breadcrumb remain
pending Task 15 navigation/history wiring. The fixture prompt visibly includes
test-control markers; these are synthetic test data, not product controls.
Markdown headings use the existing brand font and lists retain markers.
Mobile wraps text within the viewport and keeps the composer/disclaimer visible.

Announcement-only follow-ups through `846cd65` passed scoped spec and quality
review and do not change the captured layout. Owner feedback is required before
Task 15. This preview is ready for that informal checkpoint.
