# Session resources

A conversation can link up to 50 GitHub pull requests or Linear issues through
`bind_session_resource`. The native tool derives the session and team from the
conversation principal. It resolves the resource through a selected integration;
callers cannot supply a display URL or substitute another session. Re-linking the
same resource is idempotent. Only owners and managers can change bindings.

The active conversation's **Linked resources** sidebar shows the saved title,
last observed state and external link. The unlink button removes only the binding.
Linear issues are navigation links in this first version; their state is captured
when linked. This does not replace the Linear issue's `Nuphos session` attachment.

## GitHub wakeups

The existing `/github-app/webhook` ingress verifies GitHub's signature before
routing events. Enable the corresponding events on the installed GitHub App:

- Pull request: opened, reopened, closed, synchronize, ready_for_review
- Pull request review: submitted, dismissed
- Issue comment: created, on PRs only, from humans
- Check run, check suite and workflow run: completed, with associated PR numbers

The router matches the installation ID, stable repository ID and PR number.
Events without an associated PR do not wake sessions. Events from the configured
Nuphos App bot and bot issue comments are ignored to avoid reply loops. GitHub
must actually deliver a subscribed event; linking does not alter App subscriptions
or retroactively replay earlier events.

BullMQ persists deliveries using a per-binding/session/GitHub-delivery job ID,
with retry on transient delivery errors. The shared conversation runner prevents
concurrent turns and checks pending/persisted message IDs before redelivery. A
busy session receives the event through its pending-message path. Accepted turns
are not replayed just because model execution subsequently failed; inspect the
conversation for that outcome. External writes still need their own idempotency.

Before running, the worker rechecks the binding, archive state, team membership
and selected integration, then reads the PR through that integration. A revoked
or disconnected integration cannot wake the session. Unlinking also invalidates
queued deliveries by binding ID; linking again creates a new ID. Archiving stops
new event acceptance and worker wakeups, but does not cancel an already accepted
turn. Resource events preserve existing permission settings and do not initialize
Full Access. Event text is explicitly marked as external data, not human approval.

Redis and the existing trigger scheduler must be enabled for wakeups. No sandbox
watcher is used. This feature does not provision cloud resources or change the
team's GitHub App subscription settings.
