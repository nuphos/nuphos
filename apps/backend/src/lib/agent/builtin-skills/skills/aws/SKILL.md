---
name: aws
description: Run AWS CLI v2 commands from the sandbox to inspect or change AWS resources (CloudWatch, SNS, EKS, EC2, IAM, VPC, etc.). Includes the managed CloudWatch Alarm to Nuphos Trigger and Slack workflow.
---

# AWS CLI

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill when the user wants to inspect or change AWS resources directly with `aws`. The CLI is **pre-installed in the sandbox runtime image** — assume it's on PATH. Authenticate before any `aws` call — either with credentials Nuphos mints for a bound account (preferred), or with credentials the user pasted in.

## When to skip this skill

For anything Nuphos already exposes via its own API — listing EKS clusters, fetching kubeconfigs, listing/editing VPCs and NACLs on bound accounts — call the Nuphos backend route directly instead of `aws ...`. Same data, no setup, smaller blast radius:

- List EKS clusters in a bound account → `GET /teams/:teamId/aws-accounts/:accountId/clusters`
- Run kubectl against an EKS cluster → its context is `aws/<account>/<cluster>` in the kubeconfig the kubectl skill sets up
- List or edit VPCs / NACLs in a bound account → the `/teams/:teamId/aws-accounts/:accountId/...` routes

Use this skill when the user asks for something Nuphos does not expose (e.g. S3, IAM users, RDS, CloudWatch logs), or hands you keys for an account Nuphos isn't connected to.

## Setup

```bash
# Authenticate. Pick ONE path:

# (a) PREFERRED — short-lived STS creds for an Nuphos-bound account.
#     Writes ~/.aws/credentials + ~/.aws/config so plain `aws` calls work.
#     Creds expire in ~1h — re-run if commands start failing with ExpiredToken.
bash skills/aws/scripts/setup-credentials.sh <teamId> <accountId> [region]

# (b) Static keys the user pasted — pass per command, never write to disk.
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_DEFAULT_REGION=us-east-1 \
  aws sts get-caller-identity

# (c) Temporary STS keys the user pasted (3 fields).
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_SESSION_TOKEN=... \
  AWS_DEFAULT_REGION=us-east-1 aws sts get-caller-identity
```

### Fallback: aws CLI missing

If `aws: command not found` (cold start without the runtime image), run the install script first — it's idempotent:

```bash
bash skills/aws/scripts/install.sh
```

`setup-credentials.sh` calls `GET /teams/:teamId/aws-accounts/:accountId/credentials` on Nuphos backend with the user's `NUPHOS_TOKEN`. The role assumed is whatever role the team admin bound when connecting the AWS account, so the credentials inherit exactly that role's permissions.

Always run `aws sts get-caller-identity` first to confirm which account/role you are about to operate on, and tell the user before doing anything mutating.

## When you hit HTTP 403

If `setup-credentials.sh` or a credentials fetch returns HTTP 403, the current
member account does not have Access to that AWS role, or the role was not
selected for this agent session. Do not try to request temporary access from
inside the sandbox. Ask the user or a team admin to add the member account to
the role's Access allow list, or switch to another role already enabled for
this session.

## Common operations

```bash
# Identity / regions
aws sts get-caller-identity
aws ec2 describe-regions --query 'Regions[].RegionName' --output text

# EKS
aws eks list-clusters --region <region>
aws eks describe-cluster --name <cluster> --region <region>
aws eks list-nodegroups --cluster-name <cluster> --region <region>

# EC2 (read)
aws ec2 describe-instances --region <region> \
  --query 'Reservations[].Instances[].[InstanceId,State.Name,PrivateIpAddress,Tags[?Key==`Name`]|[0].Value]' \
  --output table
aws ec2 describe-vpcs --region <region>
aws ec2 describe-security-groups --region <region> --group-ids <sg-id>

# IAM (read)
aws iam list-roles --query 'Roles[].RoleName' --output text
aws iam get-role --role-name <name>

# CloudWatch logs
aws logs describe-log-groups --region <region>
aws logs tail /aws/eks/<cluster>/cluster --since 10m --region <region>
```

Always pass `--region` (or set `AWS_DEFAULT_REGION`); never rely on a default region staying constant across commands.

## Watching a CloudWatch alarm

Use this recipe when the user asks to create/watch a CloudWatch alarm and notify or investigate through Slack. The managed architecture is:

```text
CloudWatch Alarm -> SNS HTTPS subscription -> Nuphos webhook trigger
  -> first-party slack_post initial alert -> investigation -> same Slack thread
```

Do **not** replace it with AWS Chatbot, Amazon Q Developer in chat applications, Lambda forwarding, or a Slack Incoming Webhook unless the user explicitly asks for that different architecture. Nuphos owns the inbound webhook trigger and posts through its already-connected first-party Slack App.

### Slack is a capability check, not an architecture choice

Before any mutating setup for a Slack destination, call `slack_list_destinations`.

- If it succeeds, use only the exact DM/channel the user selected and persist it in `trigger_create.slackDestination`.
- If it returns `slack_not_connected`, explain that the Nuphos Slack App must be connected to this team, preserve the intended CloudWatch -> Nuphos -> Slack plan, and STOP. Never ask for a Slack webhook URL and never claim Nuphos cannot proactively post to Slack.
- If the user chose Nuphos-only delivery, do not call Slack tools or create Slack-side resources.

### Existing alarm versus a new condition

First revalidate the exact AWS account, region, and alarm with `sts get-caller-identity` and `cloudwatch describe-alarms`.

- For an **existing alarm**, the user's Watch request authorizes adding the scoped SNS delivery path while preserving every existing alarm action.
- A metric, dashboard chart, log group, or vague request such as "alert me on high CPU" is **not** an alert condition. Inspect read-only data, then propose the exact alarm name, metric/math query, dimensions, comparison, threshold, evaluation periods/datapoints-to-alarm, missing-data behavior, and ALARM/OK delivery semantics. Ask the user to approve or adjust that exact proposal and STOP. Do not create a trigger, alarm, topic, or subscription in that turn.
- Only a later explicit acceptance of that exact condition authorizes creating a new alarm and wiring it. Do not ask a second confirmation after the user accepts it.

### Complete CloudWatch -> Nuphos wiring recipe

The workflow is not live when only the trigger exists. Finish every step, read it back, drill it, and persist the secret-free receipt.

1. **Snapshot the exact alarm and connected binding.** Record the operational AWS role binding ID, 12-digit account ID, region, full alarm ARN, alarm kind (`metric` or `composite`), whether the alarm already existed, and its complete ALARM/OK/INSUFFICIENT_DATA action arrays. Refuse a permission-admin binding. The setup role needs `cloudwatch:DescribeAlarms`, `cloudwatch:PutMetricAlarm` or `cloudwatch:PutCompositeAlarm`, and the scoped SNS create/subscribe/read/delete permissions.

2. **Create the Nuphos webhook trigger** with:

   - `triggerType: "webhook"`
   - `monitoringIdentity: {provider:"aws", integrationId:"<operational role binding ObjectId>", resourceId:"<full alarm ARN>"}`
   - for Slack, `incidentMode: true` and the exact approved `slackDestination`
   - a retry-burst `minIntervalSeconds` such as 60

   Use this normalized payload contract in `messageTemplate`:

   ```text
   CloudWatch Alarm notification received.
   Status: {{payload.status}}; alarm: {{payload.alarm.name}}; state: {{payload.alarm.newState}}
   Reason: {{payload.alarm.reason}}; changed at: {{payload.alarm.stateChangedAt}}
   If payload contains "test": true or "drill": true, reply "test delivery received" and STOP — no investigation and no Slack post.
   For Slack, handle it the way an on-call engineer would. Call incident_history first to see whether this alert has gone off before and in which thread, and slack_read_channel if you want to know what is already in the channel. Post something quickly so whoever is watching knows it is being looked at, then investigate and follow up in the same thread when you know more.
   Pass replyToThread with a threadTs from incident_history when this firing is the same problem still going or coming back; omit it to start a new thread when it is genuinely different. There is no message type to declare. When it has recovered, say so in its thread and stop — nothing needs to be closed. Pass the exact destination object stored on the trigger, including slackWorkspaceId when it is present — reconstructing it as only {"type":"channel","channelId":"..."} can be refused or aimed at the wrong workspace. For a new Watch, persist that same exact object in trigger_create.slackDestination: {"type":"channel","channelId":"<the selected stable ID>","slackWorkspaceId":"<its workspace>"} for a channel, or {"type":"dm_self"} for a DM.
   For Nuphos-only delivery, keep the findings here and do not call slack_post.
   ```

   `trigger_create` returns the webhook URL and its secret once. Require an absolute permanent `https://` URL. If it is temporary and the user has not already accepted local-debug wiring, ask whether to use it and STOP; never invent or substitute a host.

3. **Create a dedicated SNS topic and HTTPS subscription.** Create a uniquely named topic such as `nuphos-watch-<triggerId>`, set its `SignatureVersion` topic attribute to `2`, and subscribe the exact endpoint `<webhookUrl>?secret=<url-encoded webhookSecret>` using protocol `https`. Nuphos verifies the AWS SNS signature and automatically confirms a valid `SubscriptionConfirmation`; do not fetch `SubscribeURL` yourself. Poll `list-subscriptions-by-topic` briefly until it returns a real subscription ARN instead of `PendingConfirmation`.

4. **Attach additively to the alarm.** Add the topic ARN to both `AlarmActions` and `OKActions` (unless the user explicitly chose only one state), de-duplicate it, and preserve every pre-existing ALARM, OK, and INSUFFICIENT_DATA action exactly.

   `put-metric-alarm` and `put-composite-alarm` are replace-style APIs: never submit only the name and action arrays. Build `--cli-input-json` from the complete `describe-alarms` snapshot, carrying every writable condition field and the existing action arrays, then add only the Nuphos topic. Re-read the alarm immediately before the PUT; if its action arrays changed since the snapshot, stop and retry from a fresh snapshot instead of overwriting concurrent edits.

5. **Read back and drill.** Read the alarm, SNS topic attributes, and subscriptions back. Verify:

   - the exact alarm ARN/account/region still matches;
   - the topic is present once in the requested ALARM/OK actions and all old actions remain;
   - topic signature version is `2`;
   - the subscription ARN is confirmed, protocol is `https`, and endpoint targets the exact Nuphos trigger path.

   Then call `trigger_test_fire` with a normalized `{"test":true,"provider":"aws_cloudwatch","status":"firing","alarm":{"name":"<name>","newState":"ALARM"}}` payload. It must take the STOP branch and not post to Slack. The signed subscription-confirmation delivery proves the SNS -> Nuphos hop; do not publish a fake unsigned provider notification.

6. **Persist deterministic cleanup.** Call `trigger_finalize_wiring` only after read-back and the drill succeed:

   ```json
   {
     "provider": "aws",
     "integrationId": "<operational role binding ObjectId>",
     "accountId": "123456789012",
     "region": "us-east-1",
     "alarmName": "High CPU",
     "alarmArn": "arn:aws:cloudwatch:us-east-1:123456789012:alarm:High CPU",
     "alarmKind": "metric",
     "alarmOrigin": "existing",
     "snsTopicArn": "arn:aws:sns:us-east-1:123456789012:nuphos-watch-...",
     "snsTopicOrigin": "created",
     "snsSubscriptionArn": "arn:aws:sns:us-east-1:123456789012:nuphos-watch-...:uuid",
     "attachedActions": ["alarm", "ok"]
   }
   ```

   The receipt contains identifiers/provenance only, never the webhook secret or AWS credentials. Future Remove Watch uses it to detach only Nuphos actions, preserve the alarm and all old destinations, delete the owned subscription, and delete a dedicated topic only when no unrelated subscription uses it.

7. **Rollback on any incomplete attempt.** Disable the trigger first, restore the alarm's original action arrays from a concurrency-checked fresh read, unsubscribe the owned subscription, delete the newly created topic when unreferenced, and delete the trigger. Report the exact permission/capability blocker; never leave an enabled half-workflow or hand ordinary setup steps back to the user when the connected role can perform them.

## Long waits

Avoid long blocking `aws ... wait ...` calls for cloud operations that can take minutes, especially EKS nodegroup and cluster deletion. Prefer short polling with `describe-*` / `list-*` commands and report the current state (`DELETING`, `ACTIVE`, gone, etc.). If you do use `aws ... wait ...`, the bash tool bounds it to a short timeout and may return exit code `124` with "still waiting"; treat that as "operation still in progress", not as a fatal failure. Check status again before running the next destructive step.

All bash tool calls also have a bounded runtime. Keep manual polling loops short, for example 3-5 iterations with sleeps, then report the current state and ask the user whether to continue. If a command returns exit code `124` with an Nuphos timeout message, assume the operation may still be running and verify with a fresh `describe-*` / `list-*` command before retrying any mutating action.

## Safety

- **Read-only by default.** `describe-*`, `list-*`, `get-*` are safe.
- **Confirm before mutating.** Anything starting with `create-`, `delete-`, `modify-`, `put-`, `update-`, `terminate-`, `attach-`, `detach-`, `revoke-`, `authorize-` requires the user's go-ahead, and you must summarize the exact resource and region first.
- **Never persist user-supplied keys.** Path (a) above writes Nuphos-minted **short-lived** creds to `~/.aws/credentials`, which is fine. Don't `aws configure` static long-lived keys the user pasted — pass them per-command via env vars instead.
- **Don't echo secrets.** Don't `echo $AWS_SECRET_ACCESS_KEY` or print `aws iam create-access-key` output verbatim — summarize "created key, prefix AKIA…" and tell the user to capture the secret on their side.
- **Don't run `aws s3 rm --recursive` or `aws s3 sync --delete`** without an explicit confirmed target.
- **Re-auth if you see `ExpiredToken`.** Re-run `setup-credentials.sh` rather than asking the user for new keys.
