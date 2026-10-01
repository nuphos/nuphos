# Account deletion operations

Users initiate permanent deletion in iOS Account → Delete account. The endpoint verifies their current account password or their account email with a single-use code. Requests are idempotent, durable, and due within 30 days of the first submission. A request does not immediately erase or suspend the account. Sign-in does not cancel it.

## Daily queue

The support operator must check Admin → Account deletions daily; it lists open requests in deadline order, highlights overdue requests, and distinguishes a failed fetch from an empty queue. Record progress and an owner immediately. The 30-day deadline includes provider cleanup. Escalate anything outstanding seven days before its deadline.

## Fulfillment checklist

1. Verify the request's user ID, identity, and timestamp. Inventory owned workspaces, memberships, owned conversations, files, local and managed agents, schedules and credentials. Never perform an unbounded email/text delete; preserve unrelated team members and shared resources.
2. Resolve ownership of shared workspaces with remaining administrators. Remove the departing user's access. Do not delete a multi-member workspace or other members' private/local agents as part of account deletion. Document the basis for retaining jointly held team content and remove personal attribution where possible.
3. Stop the user's active turns, schedules and triggers; revoke native handoffs, session/API/OAuth grants, device registrations and push tokens. Revoke provider grants owned by this account without revoking team-owned credentials required by other members.
4. Purge personal conversations/messages, attachments and file objects, personal memory/indexes, settings, drafts/server preferences, user directory caches, invitations and owned-only workspace data. Include object storage, runtime workspace copies and search indexes; inspect current models rather than assuming this list exhausts future collections. Wait for in-flight jobs to stop before final purge so they cannot reinsert content.
5. Fulfill deletion in processors receiving personal data: PostHog profiles/events, Braintrust traces, and applicable model/hosting providers. Save provider receipts; record justified statutory retention and backup expiry separately. An audit log is not a general exemption for retaining prompts or attachments.
6. Permanently remove the `users` document including email, Google subject, password hash and AI consent, and clear email OTP/login-attempt data. All user JWTs then fail the live-user lookup. Verify fresh unauthenticated and previous-session requests cannot access the erased identity. Recheck for late writes.
7. Notify the user at the request email that deletion is complete and explain any justified retention. Record redacted evidence (resource counts, provider receipt IDs, dates and retention basis) without copying personal content or credentials into the receipt.
8. Record completion in Admin. The backend refuses completion while a `users` document still exists (even soft-deleted), clears the request email when completed, and retains minimal fulfillment evidence. The completion button is a receipt only: it never substitutes for steps 1–7.

The application does not automatically perform this cross-system purge. Staffing the queue and executing this runbook is an operational requirement of the 30-day service commitment. Do not mark a request completed based only on disabled access or a soft-delete flag.
