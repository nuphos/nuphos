# Free workspace access

All Nuphos features are available without activation, a paid plan, a credit balance, or an AWS Marketplace subscription. This applies to agent messages and triggers, suggestions, file transfers, team skills, dashboard execution and scheduled refreshes, member invitations and domain joins, cloud connections, and audit-history queries.

Authentication, team roles, credential access, operational rate limits, and provider/runtime requirements still apply. Nuphos access does not supply cloud resources or model-provider credentials.

The application no longer provisions Stripe customers, accepts payments, creates subscriptions or invoices, consumes prepaid wallets, or processes Stripe/Marketplace billing events. Pricing configuration and payment UI have been removed from Desktop and Admin. Existing billing documents remain untouched and have no effect on access; old clients receive an always-active compatibility summary.

Desktop no longer includes the Settings Usage page or conversation cost amounts. Internal provider cost accounting and token diagnostics remain available for operations. New token usage is recorded as uncharged background usage. The read-only usage endpoint is `/teams/:teamId/usage`; `/teams/:teamId/billing/usage` remains as an alias for saved dashboard scripts and older clients.

## Deployment boundary

This code change does not cancel subscriptions already held by Stripe or AWS Marketplace. Removing application handlers does not stop those providers' recurring collections. Any existing external subscriptions and listing configuration must be handled separately as part of an authorized production rollout. No production subscription or historical financial data is changed by this worktree.

## Temporary file storage

All teams share the same operational protection for managed file transfers: at most 60 new transfer groups and 5 GiB of declared uploads per fixed UTC hour per team. Reservations are atomic across backend replicas and fail closed if the counter store is unavailable. Existing per-file (100 MiB), per-group (500 MiB / 20 files), 15-minute signed URL, and 24-hour retention limits remain. Upload signatures bind Content-Length; finalization rejects and deletes size mismatches. These are abuse controls, not a paid tier or upgrade path. Presigned URLs remain reusable until expiry; this is not a hard bandwidth billing quota.
