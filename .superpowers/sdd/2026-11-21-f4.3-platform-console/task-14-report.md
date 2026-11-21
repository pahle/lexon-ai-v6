# Task 14 report

Status: DONE. Files: platform-console/account-record.tsx, api.ts (account, setDisabled, revokeSessions, sendVerification), app/(workspace)/platform/accounts/[userId]/page.tsx (mounted), test/platform-console/account-record.spec.tsx (10 tests). RED run: spec failed to resolve the missing module before implementation. Kit change: RelatedTable gained an optional emptyTitle prop (additive).

Own id comes from useWorkspace().identity.user.id; self sees no Disable, Sign out everywhere, or Resend verification (Enable stays for a disabled account).
Disable confirm uses ConfirmDialog destructive (button class carries --lexon-destructive-fill).

Copy not in the prototype:
- Toasts: "Verification email sent to <email>.", "Account enabled.", "Account disabled.", "<name> was signed out everywhere."
- Errors: "Too many requests. Wait a moment and try again." (429), "This email address is already verified." (409), "You cannot do that to your own account.", "This is the last platform administrator. Make another account an administrator first.", "This account no longer exists.", re-auth via identityMessage.
- Dialogs: "Disable <name>?" / "They are signed out everywhere and cannot sign in. Their teams and content stay unchanged. You can enable the account again."; "Sign <name> out everywhere?" / "All their active sessions end. They can sign in again."
- States: "Account not found" / "It may have been removed, or the link is wrong." + "Back to accounts"; failure "We could not load this account."; loading label "Loading account".
Concerns: unverified accounts show Resend verification email in place of Sign out everywhere (prototype shows only Resend + Disable). Team rows link to /platform/organizations/<id> (not built yet). Active-session tile for an unverified account is whatever the API returns.
