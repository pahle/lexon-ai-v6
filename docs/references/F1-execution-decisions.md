# F1 execution decisions

Complete recorded execution rulings, in ledger order, with rationale and stated
consequence if wrong. Source specs and the approved design remain authoritative.

1. Ruling: use the existing dedicated feature checkout — user has selected its branch and review location — local edits are visible in this checkout if wrong, main stays untouched.

2. Ruling: approved execution clarifications bind every task, even where older task prose is broader — infrastructure primitives return facts and modules own policy; audit type belongs to DB boundary — tests may need extra typed adapters if wrong.

3. Ruling: shared files/interfaces are extended sequentially; migrations are append-only — later tasks cannot rewrite shipped earlier migrations — an omitted field requires a new migration if wrong.

4. Ruling: adapter facade may use a private Drizzle transaction scope to survive native HTTP handler runWithAdapter context reset — public facade avoids recursion without package patch — needs explicit handler regression; native hook timing must be documented and later mail deferred to true outer commit.

5. Task2 BASE:34945d9; RED5fail/3pass (missing Personal/grants). Ruling: F0 migration assertion appAuthUsage becomes true — F1 requires schema USAGE for exact per-column auth reads — negative privilege tests must prove secret columns remain inaccessible.

6. Task4 BASE:e1727b3. RED10missing-contract tests; initial GREEN10/10; contracts build/workspace typecheck/lint PASS. Ruling: native invitation status mapping/expiry stays in Task12 domain service — shared schemas publish public spellings without importing auth/business policy — later mapper must be verified against these contracts. Common name/email fields added to existing shared identity.ts to avoid runtime schema cycles.

7. Task6 Ruling: public queue barrel exports createAuthLimiter lazily plus type-only AuthLimiter; safe error class is separate — worker trace RED proved a static class re-export loaded API-only limiter code — later API consumers call the async factory; cost if wrong is a factory adaptation, not widened worker imports. Initial full suite45files/182tests passed before this isolation regression, then worker RED reproduced the unwanted import.

8. Task7 current: focused19/19 GREEN after native impersonation permission RED, lifecycle double-close RED (close now idempotent), error-cookie RED (only deletion cookies survive errors), redirect RED (same-origin normalization handles immutable Responses), chunked body RED (cancel destroyed socket; now bounded read releases lock and returns413 with Connection close). Actual raw Node dot/encoded-path tests pass. IdentityAccessModule keeps AUTH_INTEGRATION private; no generic capability/native AuthService export. Existing logging tests pass. Added atomic policy/native-error rollback regression before final suite. Ruling: get-session/sign-out use a bounded TTL write-availability probe instead of a sign-in attempt bucket — satisfy ARC5.4 fail-closed without consuming credential-attempt quotas — cost is one extra Valkey write per session route request.

9. Ruling: add0006_account_primitives for reviewed narrow lock functions; shift only later uncommitted slots to0007_session_security,0008_org_invariants,0009_admin_setup — Task8 locked eligibility/account changes need these functions before later invariant migrations — cost if wrong is uncommitted slot/name coordination; existing0000–0005 stay untouched.

10. Ruling: setup grants use digest-keyed versioned records in existing auth.verification, namespace lexon.admin-setup.v1: — supported native adapter avoids a parallel grant store; Task16 supplies admission/lifecycle constraints — cost if wrong is a storage migration before API mounting.

11. Ruling: server-side policy bypass tests target Lexon's selected policy facade, not unrestricted private compatibility fixtures — user explicitly keeps business policy out of infrastructure primitives — cost if wrong is tightening the facade API; never put domain callbacks into DB plugins or weaken infrastructure-domain.

12. Ruling: verification completion removes only native verification-created response credentials in the same transaction — pinned1.7.14 email-change path ignores autoSignInAfterVerification=false, while the design prohibits automatic verification sign-in — cost if wrong is adapting the completion wrapper when the pinned implementation changes; a real regression proves no new session and unchanged existing access.

13. Ruling: resolve native response cookies by final name value — real Bearer refresh+disable emitted old and replacement session cookies of the same name; replaying both resolved the deleted token and failed401 — cost if wrong is adapting the private projection if cookie scope/prefix configuration changes; active regression covers hard cap, channel, selection and discarded old MFA evidence.

14. Ruling: Task9 proves platform-admin MFA evidence is cleared on disable; the operational HTTP denial assertion is explicitly in Task11 alongside the guard — no protected application guard exists before Task11 and no production auth mounting before17 — cost if wrong is a missed integration assertion until11/15; the plan now names the downstream check.

15. Ruling: new unique(organization_id,user_id) rejects duplicate Personal membership with23505 before the earlier deferred23514 — preserves the same invariant and adds required uniqueness — cost if wrong is an assertion diagnostic change, not an authorization change.

16. Ruling: extend shared settings with validated optional slug — approved design/Task10 allow owner slug changes but Task4 contract omitted it — cost if wrong is a small contract correction before frontend17–24; no extra public mutation fields.

17. Ruling: OrganizationAuthPort callback also receives a private copy of the verified server headers — native APIs need actor credentials while the real transaction command must retain its audit binding; a wrapping/fake command would break that binding — cost if wrong is changing trusted callback plumbing; credentials never enter VerifiedIdentity or response DTOs and no caller header override is accepted by the service.

18. Ruling: correct CommonJS identifier detection rather than rename the approved Policy.require API — noncomputed property/method keys are names, actual global require references still violate ESM boundaries, including three newly covered bypass forms — cost if wrong is a parser-shape adjustment backed by62 fixtures; no infrastructure-domain relaxation.

19. Ruling: Task11 adds0009_session_selection and moves the uncommitted admin migration slot to0010 — conditional selection/default/snapshot protection is needed before guard mounting and committed0007/0008 remain append-only — cost if wrong is coordinating a future filename, no historical rewrite.

20. Ruling: snapshot the active organization name only when a verified member selection is assigned — removed-member fallback can display that session's former name without querying an arbitrary inaccessible organization — cost if wrong is stale display text after a rename, not disclosure of a new name.

21. Ruling: native null selection updates retain the former pointer until conditional Personal repair — native leave otherwise conflicts with non-null defaults or loses membership_removed context — cost if wrong is a repair on the next request; no client can unset selection or access the departed team.

22. Ruling: hold verified request identity in an interceptor through the controller Observable's completion/cancellation — a successful guard alone cannot preserve asynchronous lifetime — cost if wrong is a scope-lifecycle regression; real asynchronous Nest/RLS and post-request expiry tests cover it.

23. Ruling: Task12 adds0010_invitation_lifecycle and moves the uncommitted admin slot to0011 — the plan claimed normalized pending-email uniqueness already existed, but committed migrations only had membership and first-owner uniqueness; add the missing partial unique index plus strict invitation audit variant without rewriting history — cost if wrong is migration sequencing coordination and resolving any pre-existing duplicates before production migration (F1 is greenfield).

24. Ruling: append0012 for strict session lifecycle audit variants; move uncommitted admin slot to0013 — keep all historical migrations immutable — cost if wrong is future migration filename coordination, no runtime authorization exception.

25. Ruling: member insert/update locks user and rejects native platform-admin role for team memberships — staff must never gain team membership through another service or native path, Personal remains required — cost if wrong is rejecting a future intentionally mixed staff/customer identity; that requires an explicit architecture revision.

26. Ruling: use separate lexon_setup operator role with narrow function execution — approved operator-only initiation cannot be enforced with the long-running lexon_auth credentials, and lexon_migrator is migration-only — cost if wrong is adding one externally provisioned operator secret; no existing role gains privileges or broadens runtime access.

27. Ruling: redemption validates a live setup proof without consuming activation authority — approved design says single-use for activation and signup/email verification/TOTP must continue using the setup proof — cost if wrong is repeatable harmless landing validation until completion; consumed grants are rejected on redemption and completion.

28. Ruling: pending operator retry rotates the digest on the same grant ID and sends a replacement link — a digest-only store cannot resend the old raw token, and delivery failure must be recoverable before expiry — cost if wrong is invalidating an earlier unconsumed email link after an operator repeats the command; no duplicate setup identity or authority is created.

29. Ruling: operator-only begin is a narrow database command capability, not an endpoint registered on the runtime BA engine — the dedicated operator role cannot use broad auth adapter DML and API credentials must never initiate setup — cost if wrong is a separate operator composition port; runtime redemption/activation still use server-only BA plugin APIs and the same authoritative verification/user tables.

30. Ruling: declare pinned required vendor peers explicitly rather than disable strict peer enforcement — pnpm deploy resolves the production importer independently and exposed missing required peers — cost if wrong is a few explicit ancillary dependency pins; Drizzle remains the application's SQL layer.

31. Ruling: tolerate at most50ms between native cookie expiry/creation timestamp reads in configured-lifetime regression — observed1ms difference is native construction scheduling, not a configuration change — cost if wrong is masking a sub50ms cookie lifetime error; controlled Bearer hard-cap assertions remain exact.

32. Ruling: Task19 browser scenarios live under backend/test/e2e because they import privileged Compose mail-control and server fixture helpers — frontend lint correctly rejects backend/test and node builtins, and the rule remains unchanged — cost if wrong is a test path deviation; frontend package E2E mapping explicitly includes identity-browser.

33. Ruling: Task22 E2E operator fixture injects in-process mail at the operator composition instead of a Mailpit/SMTP service — automated tests must retain in-process transport and API must never receive lexon_setup; the actual CLI and SMTP bridge are already covered in16 — cost if wrong is one test-only composition script, bind-mounted and absent from production images, plus private ephemeral host configuration.

34. Ruling: allow up to30seconds for test-owned API process startup rejection instead of6 — full Compose failed only during concurrent CPU-heavy builds, and auth composition adds real boot work; rejection must still exit1 and correct policy must recover — cost if wrong is slower failure detection in this smoke harness, not acceptance of an unsafe Valkey configuration. Observed focused recheck rejects3cases in3450/3637/4625ms and correct startup recovers; final full run pending.

35. Final: Ruling: preserve token rotation on pending operator retry despite possible out-of-order email arrival — only the latest issued grant may authorize setup, a late earlier message must never restore superseded authority; deterministic out-of-order delivery test proves latest accepted/older403 and single record — cost if wrong is an invalid older email arriving last; recipient gets generic unavailable state and operator can resend. No queue/durable-mail scope added.

## Review outcome

The first fresh reviewer hit a model usage limit before completing its verdict.
A replacement fresh reviewer completed a bounded targeted whole-branch review
covering all five requested focus areas; it did not claim to read every changed
line. It found two Important issues and no Critical/Minor issues; Declined to
judge was empty. The quota-alias and pending-SMTP findings received real failing
HTTP/CLI regression tests before fixes. No second review was commissioned.

Earlier Task19–22 backend typecheck claims in execution were premature; the
completed typecheck later exposed missing NodeNext .js test-import suffixes.
Those were corrected, and the complete root/backend typechecks subsequently
passed. This correction supersedes the earlier ledger claims.

Deferred minors: none.
