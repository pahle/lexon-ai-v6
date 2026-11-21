# Task 13 report

Status: DONE_WITH_CONCERNS. Components built and tested; route NOT switched.

Files: frontend/src/components/platform-console/{api.ts,accounts-page.tsx,invitations-tab.tsx,invite-dialog.tsx}; frontend/test/platform-console/accounts.spec.tsx (13 tests).

Route: frontend/src/app/(workspace)/platform/accounts/page.tsx still renders the old AccountStatusForm. AccountsPage is exported from accounts-page.tsx and is ready to mount. Switching it breaks backend/test/e2e/platform-identity.spec.ts (~632): the sidebar 'Account status' link click and the 'User ID' field expectation on /platform/accounts (plus any submit of the disable/enable form there). account-status-form.tsx is not deleted for the same reason. Task 16 should switch the route, update E2E, then delete the form.

Notes: invitations tab is `?tab=invitations` ('tab' rides as a facet key so filters keep it). Fetch helper api.ts (PlatformApiError extends IdentityClientError and carries issues) because the identity client has no account methods; reauth text reuses identityMessage. Invite success prepends to cached page-1 invitation queries, marks them stale, toasts. Name field empty is treated as absent (schema rejects '').
Gaps: tab count pills, invitation row menu, and account row menu beyond "View account" are not built (not in brief; later tasks). Accounts row opens /platform/accounts/<id> (detail task). Implementation was written before the spec was first run (no separate RED run).

## Follow-up: invitation actions and tab counts
RED run first: 6 new tests failed (13 old passed), then all 19 pass.
- Tab pills: separate count queries (page 1, size 10, unfiltered) per list; invalidated after invite/resend/cancel.
- Invitations row menu "Actions for <email>": Resend invitation, Cancel invitation (destructive, last); both via api.ts with the same error handling as invite (re-auth text via identityMessage).
- Copy (not in prototype, mine): toasts "Invitation resent to <email>.", "Invitation to <email> canceled."; errors "Too many requests. Wait a moment and try again." (429), "That invitation no longer exists." (404, list refetched), re-auth message from identityMessage. ConfirmDialog: title "Cancel the invitation to <email>?", description "The link in the email stops working. You can invite them again later.", confirm "Cancel invitation".
- Note: the confirm button and menu item share the label "Cancel invitation"; the dialog's dismiss button is the kit's "Cancel".
