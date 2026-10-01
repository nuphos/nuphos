---
name: gcloud
description: Run Google Cloud SDK (gcloud) commands from the sandbox to inspect or change GCP resources (GKE, Compute Engine, IAM, networking). Includes scripts to install the SDK and to load a short-lived access token for an Nuphos-bound project.
---

# gcloud (Google Cloud SDK)

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill when the user wants to inspect or change GCP resources directly with `gcloud`. The SDK is **pre-installed in the sandbox runtime image** — assume it's on PATH. Authenticate before any `gcloud` call — either with a token Nuphos mints for a bound project (preferred), or with a service-account key the user pasted.

## When to skip this skill

For anything Nuphos already exposes via its own API — listing Compute Engine instances or GKE clusters in a bound project, fetching kubeconfigs, listing/editing firewall rules — call the Nuphos backend route directly instead of `gcloud ...`. Same data, no setup, smaller blast radius:

- List Compute Engine VMs in a bound project → `GET /teams/:teamId/gcp-projects/:projectId/gce-instances` (every zone, with machine type, status, IPs, network and labels)
- List VPC networks → `GET /teams/:teamId/gcp-projects/:projectId/vpcs`
- List GKE clusters in a bound project → `GET /teams/:teamId/gcp-projects/:projectId/clusters`
- Anything `kubectl` against a GKE cluster → its context is `gcp/<project>/<cluster>` in the kubeconfig the kubectl skill sets up, with self-renewing credentials. Never run `gcloud container clusters get-credentials` — it plants a gcloud-auth kubeconfig entry that breaks once the gcloud token expires.
- List or edit firewall rules in a bound project → the `/teams/:teamId/gcp-projects/:projectId/...` routes

A bound project need not run Kubernetes. A project with only Compute Engine VMs is a normal binding: `clusters` comes back empty (or reports the Kubernetes Engine API as disabled), and the GCE routes above are the ones to use.

Use this skill when the user asks for something Nuphos does not expose (e.g. Cloud Logging queries, Cloud Storage, Pub/Sub, IAM bindings), or hands you a key for a project Nuphos isn't connected to.

## Setup

```bash
# Authenticate. Pick ONE path:

# (a) PREFERRED — short-lived impersonated token for an Nuphos-bound project.
#     Configures gcloud's auth/access_token_file + active project. Token expires
#     in ~1h — re-run if commands start failing with reauth errors.
bash skills/gcloud/scripts/setup-credentials.sh <teamId> <projectId>

# If the project has multiple bound service accounts, pass the selected binding.
bash skills/gcloud/scripts/setup-credentials.sh <teamId> <projectId> <serviceAccountId>

# (b) Service-account key the user pasted — write to a tmpfile, activate, delete.
key="$(mktemp --suffix=.json)"
cat > "$key" <<'JSON'
{ ...service account JSON the user gave you... }
JSON
gcloud auth activate-service-account --key-file="$key"
shred -u "$key" 2>/dev/null || rm -f "$key"

# (c) Raw access token the user pasted — works for one-off read commands.
CLOUDSDK_AUTH_ACCESS_TOKEN="ya29...." gcloud projects list
```

`setup-credentials.sh` calls the ordinary `GET /teams/:teamId/gcp-projects/:projectId/credentials` API with `NUPHOS_TOKEN`. When the bearer is a conversation principal, the backend automatically restricts it to this conversation's selected service accounts. When `<serviceAccountId>` is provided, the script adds `?serviceAccountId=...` and impersonates that exact allowed binding; otherwise the backend selects an allowed operational service account for the project. The token inherits exactly that SA's permissions. Permission-admin (human-only, IAM-escalation) service accounts are never handed out through this path.

After authenticating, confirm identity before doing anything mutating:

```bash
gcloud config list
gcloud auth list   # or: gcloud projects list (sanity check)
```

### Fallback: gcloud missing

If `gcloud: command not found` (cold start without the runtime image), run the install script first — it's idempotent:

```bash
bash skills/gcloud/scripts/install.sh
```

### HTTP 403

If `setup-credentials.sh` returns HTTP 403, your member account does not have
Access to the selected service account binding, or the service account was not
selected for this agent session. Ask a team admin to add your member account to
the binding's Access allow list in Settings -> Integrations, or choose another
service account already enabled for this session. Retry the setup command after
the allow list changes.

### Impersonation / getAccessToken denied

If `setup-credentials.sh` returns `cloud_api_error` with
`PERMISSION_DENIED: unable to impersonate` or
`iam.serviceAccounts.getAccessToken`, the platform cannot mint a token for the
bound connector service account. Do not create a plan for local execution.
Tell the user to use their locally authenticated `gcloud` to grant Token Creator
on the bound service account to the team-scoped workload identity principal
shown by the GCP binding wizard, then retry after IAM propagation.

The local command shape is:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  <bound-service-account-email> \
  --project=<project-id> \
  --member="principal://iam.googleapis.com/projects/<nuphos-project-number>/locations/global/workloadIdentityPools/<pool-id>/subject/nuphos:team:<team-id>" \
  --role="roles/iam.serviceAccountTokenCreator"
```

After the local command succeeds, retry `setup-credentials.sh` or the original
GCP operation to verify the impersonation grant works.

### No binding, or a binding on the wrong project

Creating the Nuphos-side binding is a human step. `POST /teams/:teamId/gcp-projects`
answers `403 conversation_api_forbidden` for every agent conversation, whatever
the user's team role, so do not present it as missing permissions or ask for the
API to be opened.

Do the parts you can and leave only the click:

1. Confirm which project the resources actually live in (a 403 preflight on a
   freshly bound project usually means the binding names a different project).
2. Prepare the service account, its project roles, and the Token Creator grant
   for the team's workload identity principal with the user's own authenticated
   `gcloud` — through `local_exec` when it is available, otherwise by handing the
   user the exact commands.
3. Tell the user to bind it in the Nuphos app under Settings -> Integrations,
   giving them the service account email and project id to enter, then retry.

## Common operations

```bash
# Identity / projects
gcloud projects list
gcloud projects describe <project-id>

# GKE
gcloud container clusters list --project <project-id>
gcloud container clusters describe <cluster> --region <region> --project <project-id>
gcloud container node-pools list --cluster <cluster> --region <region> --project <project-id>

# Compute Engine (read)
gcloud compute instances list --project <project-id>
gcloud compute instances describe <name> --zone <zone> --project <project-id>
gcloud compute networks list --project <project-id>
gcloud compute firewall-rules list --project <project-id>

# IAM (read)
gcloud iam service-accounts list --project <project-id>
gcloud projects get-iam-policy <project-id>

# Logs
gcloud logging read 'resource.type="k8s_cluster" AND severity>=ERROR' \
  --project <project-id> --limit 50 --freshness=1h
```

`setup-credentials.sh` already pins `core/project`, but pass `--project` explicitly when working across multiple projects in the same turn.

## Watching a saved Cloud Monitoring dashboard panel

The desktop's dashboard Watch prompt identifies the exact project, service-account binding, dashboard ID, widget ID/ref, saved query source, and current dashboard filters. Treat those identifiers as the source of truth; do not reconstruct a metric from the panel title.

1. Authenticate with the exact binding from the prompt, then read the provider-owned dashboard back:

   ```bash
   bash skills/gcloud/scripts/setup-credentials.sh <teamId> <projectId> <serviceAccountId>
   gcloud monitoring dashboards describe <dashboard-id> --project <projectId> --format=json
   ```

2. Resolve the prompt's stable widget ref against the returned layout: `mosaic:N` is `mosaicLayout.tiles[N].widget`, `grid:N` is `gridLayout.widgets[N]`, and `row:R:W` / `column:C:W` identify the nested row/column widget. Verify its widget ID/title and use the saved `timeSeriesQuery`; apply the prompt's selected dashboard-filter values exactly.

3. A chart is not automatically an alert policy. If the widget references an existing alert policy, read that policy back and use its exact condition. If a **new** alert policy is required, confirmation is a hard boundary even when the chart contains threshold markers or the recent baseline suggests an obvious value:

   - Read-only inspection is allowed. Use the saved query and recent data to prepare one concrete proposal covering the comparison and threshold, duration, per-series versus cross-series aggregation/reducer, and missing-data/auto-close behavior.
   - Present that exact proposal to the user, call `request_user_decision` with category `approval` (include approve and adjust as the options), ask them to approve or adjust it, then **STOP and end the turn**. Do not call `trigger_create`; do not create or update an alert policy, notification channel, or any other provider resource in that turn.
   - Only a later user message that explicitly accepts or specifies the alert condition authorizes creation. The Watch click, destination choice, the agent's own recommendation, silence, or an unrelated reply is not approval. Never treat your proposed threshold as the user's confirmation.

4. Once an exact alert policy exists, use the additive webhook wiring recipe below. Preserve all existing notification channels and scope the new path only to that policy.

## Wiring a Cloud Monitoring alert to a Nuphos agent trigger

Use this when the user says "watch this alert policy / when X fires, do Y". Same pattern as the grafana skill's recipe: GCP keeps the condition (the alert policy), Nuphos receives the notification (a webhook trigger), a fresh agent session performs Y. Requires `roles/monitoring.editor` (or the channel+policy editor pair) on the project — a 403 means the bound service account lacks it; guide the user to grant instead of improvising.

**Completion contract:** `trigger_create` only creates the Nuphos receiver; the Watch is not live until the GCP notification channel is created, attached additively to the exact alert policy, read back, and drill-tested. For an existing alert policy, the generated Watch prompt authorizes those scoped additive changes. For a dashboard panel that needs a new policy, the user's later explicit approval of the exact condition authorizes policy creation and the scoped wiring; after that approval, do not ask for another confirmation or hand setup commands back to the user when the connected service account can run them.

If the requested destination is Slack, call `slack_list_destinations` before creating the trigger. Use only the user's explicit DM/channel choice, persist it in `trigger_create.slackDestination`, and name the same stable ID/DM in the messageTemplate. If the user chose Nuphos, do not add Slack delivery.

1. **Create the webhook trigger** with `trigger_create` (`triggerType: "webhook"`; set `monitoringIdentity` to `{provider:"gcp", integrationId:"<project ID>:<connected service-account email>", resourceId:"<full alert-policy name>"}` so retries reuse one trigger; when Slack is the action, also set `incidentMode: true` and the exact approved `slackDestination`). Cloud Monitoring's webhook body is `{"version": "1.2", "incident": {...}}` — the useful fields are `incident.state` ("open" | "closed"), `incident.policy_name`, `incident.condition_name`, `incident.summary`, `incident.url` (console deep link), `incident.started_at`. Write the messageTemplate as the ACTION, branching on state:

   ```text
   Cloud Monitoring notification received (state: {{payload.incident.state}}).
   Policy: {{payload.incident.policy_name}} — {{payload.incident.summary}}
   If the payload contains "test": true or "drill": true, reply "test delivery received" and STOP — no investigation.
   For Slack, handle it the way an on-call engineer would. Call incident_history first to see whether this alert has gone off before and in which thread, and slack_read_channel if you want to know what is already in the channel. Post something quickly so whoever is watching knows it is being looked at, then investigate and follow up in the same thread when you know more.
   Pass replyToThread with a threadTs from incident_history when this firing is the same problem still going or coming back; omit it to start a new thread when it is genuinely different. There is no message type to declare. When it has recovered, say so in its thread and stop — nothing needs to be closed. Pass the exact destination object stored on the trigger, including slackWorkspaceId when it is present — reconstructing it as only {"type":"channel","channelId":"..."} can be refused or aimed at the wrong workspace. For a new Watch, persist that same exact object in trigger_create.slackDestination: {"type":"channel","channelId":"<the selected stable ID>","slackWorkspaceId":"<its workspace>"} for a channel, or {"type":"dm_self"} for a DM.
   For Nuphos-only delivery, keep the findings here and do not call slack_post.
   ```

   A Slack firing notification uses one root message for one incident conversation, followed by one investigation-result reply. Later meaningful changes and recovery also stay in that thread. Tell the user they can reply there to continue with Nuphos.

   The result gives you `webhookUrl` and `webhookSecret` (returned only once). Sanity check: the `webhookUrl` must be an absolute `https://` URL — a bare path means the backend has no public base URL; STOP and tell the user. NEVER substitute a different host.

2. **Create a webhook notification channel** with the secret embedded as `?secret=` in the URL (the Nuphos receiver authenticates on that; the `auth_token` query GCP appends itself is ignored). Pass the definition via `--channel-content-from-file` so the secret never lands in process args or shell history, and shred the tmpfile after:

   ```bash
   CHANNEL_FILE=$(mktemp)                 # unpredictable path, mode 0600
   trap 'rm -f "$CHANNEL_FILE"' EXIT      # cleaned up even on failure/interrupt
   cat > "$CHANNEL_FILE" <<'EOF'
   {
     "type": "webhook_tokenauth",
     "displayName": "nuphos-<trigger name>",
     "labels": { "url": "<webhookUrl>?secret=<webhookSecret>" }
   }
   EOF
   gcloud beta monitoring channels create \
     --channel-content-from-file="$CHANNEL_FILE" \
     --project <project-id>
   # Note the returned channel name: projects/<p>/notificationChannels/<id>
   ```

3. **Attach the channel to the alert policy** — additively, so the team's existing channels (email, Slack…) keep working:

   ```bash
   gcloud alpha monitoring policies update projects/<p>/alertPolicies/<policy-id> \
     --add-notification-channels=projects/<p>/notificationChannels/<channel-id> \
     --project <project-id>
   ```

   If the user instead wants ONLY the agent notified, confirm before removing existing channels — never silently detach a team's notifications.

4. **Control noise at every layer.** Cloud Monitoring is naturally transition-oriented; keep a sensible condition duration/retest window and set `minIntervalSeconds` for retries. For Slack, `incidentMode` additionally guarantees one root per open incident, only material in-thread updates (at most once per 15 minutes / three per hour), and one resolution. Repeated timestamps, small metric movement, and unchanged evidence should not call `slack_post`.

5. **Verify before saying live**: describe the new notification channel and alert policy, and verify the policy contains the new channel plus every channel it had before. Then run `trigger_test_fire` with a representative payload (`{"test": true, "incident": {"state": "open", "policy_name": "...", "summary": "..."}}`) to check the cheap action branch. GCP has no channel test-send CLI; changing a live condition to force an incident is a separate risky action and still requires explicit approval.

6. **Register deterministic cleanup.** After read-back and the drill succeed, call `trigger_finalize_wiring` with `provider: "gcp"`, the project ID, connected service-account email, full alert-policy name, full notification-channel name, and `alertPolicyOrigin`. Use `existing` when the alert policy predated this Watch; use `created` only when this workflow created the policy after the user explicitly approved its exact condition. Store resource names and provenance only — never access tokens or the webhook secret. The Watch is not complete until this call succeeds.

If channel creation, policy attachment, read-back, or the drill fails, remove the channel from the policy, delete the newly created channel, and delete the newly created trigger when safe. Report the exact blocker; do not leave an enabled half-configured workflow.

To tear down, confirm with the user and call `trigger_delete`; the backend removes only the finalized channel from the exact policy, verifies it, deletes the channel, then deletes the local trigger. Do not separately mutate GCP first.

## Safety

- **Read-only by default.** `list`, `describe`, `get-*` are safe.
- **Confirm before mutating.** Anything with `create`, `delete`, `update`, `set-*`, `add-*`, `remove-*`, `apply`, `start`, `stop`, `reset`, `resize` requires the user's go-ahead, and you must summarize the exact resource and project first. A generated Watch prompt confirms additive wiring for an existing exact policy. It does not confirm creation of a new policy from a dashboard chart; that requires the mandatory later condition approval above. Once received, do not ask twice.
- **Don't persist user-supplied keys.** Path (a) above stores an Nuphos-minted **short-lived** token (no refresh secret) under `~/.config/gcloud/`, which is fine. For a service-account key the user pastes, use a tmpfile and `shred -u` after activation.
- **Don't leak tokens.** Don't `cat ~/.config/gcloud/nuphos-access-token` back to the user, and don't print `gcloud auth print-access-token` output — pipe it directly into the next command.
- **Be careful with `gcloud projects delete` and `gcloud container clusters delete`** — both are immediate and destructive.
- **Re-auth if you see reauth errors.** Re-run `setup-credentials.sh` rather than asking the user for new credentials.
