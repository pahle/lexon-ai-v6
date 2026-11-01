# Transactional email

SmtpMailer uses pinned Nodemailer 10.3.1 with bounded SMTP timeouts, file/URL
access disabled, English templates and same-origin action/callback validation.
Messages are dispatched after auth transaction commit; rollback discards callbacks.
The delivery queue is process memory, not a durable mail outbox. SMTP failure does
not reveal account existence or undo committed authorization; invitation resend
and repeated operator setup provide explicit recovery. Process shutdown drains
pending delivery within a bound. Later durable delivery requires a separate design.

Runtime transport receives SMTP configuration only in API/operator composition.
Mailpit is optional development-only, exact tag+digest in the shared image
manifest, ephemeral, internal SMTP and loopback inbox UI, with no forwarding.
Production images and default CI do not include it.

Integration tests inject an in-process transport. Compose E2E binds test-only API
composition scripts and a mode0600 Unix control socket on health tmpfs. Operator
E2E has a separate privileged test composition using the same setup domain command
and in-process Nodemailer transport. Host fixtures retain messages only in memory;
no public inbox endpoint or production capture flag exists. Never log addresses,
message content, action URLs, passwords, seeds/codes, tokens or SMTP connection
strings. Credential browser artifacts and automatic page snapshots are disabled.
