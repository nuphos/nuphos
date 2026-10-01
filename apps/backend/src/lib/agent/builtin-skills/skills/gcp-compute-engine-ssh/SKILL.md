---
name: gcp-compute-engine-ssh
description: Run shell commands on a bound GCP Compute Engine (GCE) VM from the sandbox over SSH, via `gcloud compute ssh --command` (with IAP tunneling for VMs without a public IP). Covers credential setup, the OS Login + IAP IAM permissions the bound service account needs, piping multi-line scripts over stdin, and troubleshooting "Permission denied (publickey)".
---

# GCE — run commands on a bound VM over SSH

Use this skill when the user wants to **execute commands on a specific Compute Engine VM** in a bound GCP project — one-off diagnostics (`df -h`, `systemctl status`, read a log), or piping an install/config script onto the box. This is the sanctioned "SSH channel" the `loki` skill uses to install collectors; anything below the access layer is the same for every VM.

The command channel is **`gcloud compute ssh <vm> --zone <zone> --command "…"`** running inside the sandbox. Prefer it over the desktop terminal's ephemeral-key path because `gcloud` handles key provisioning through OS Login **and** tunnels through IAP for VMs with no external IP — the raw path can't.

## When to skip this skill

- **Data Nuphos already exposes** (list instances, firewall rules) → call the backend route or the `gcloud` skill's read commands. Don't SSH just to read metadata.
- **Fleet log collection** → use the `loki` skill; it wraps this channel with the collector playbook.
- **Interactive shell for a human** → that's the desktop terminal (Instances → SSH), not the agent.

## Access layer — authenticate first

Credentials come from the **`gcloud` skill** — this skill does not re-mint them. The GCP service account must be enabled in this session's credential selector.

```bash
# Short-lived impersonated token for the bound project (pins core/project too).
bash skills/gcloud/scripts/setup-credentials.sh <teamId> <projectId>
# If the project has multiple bound SAs, pass the selected one:
bash skills/gcloud/scripts/setup-credentials.sh <teamId> <projectId> <serviceAccountId>

gcloud config list          # confirm identity + project before doing anything
gcloud compute instances list   # resolve the VM's name + zone if the user gave an IP/partial name
```

If `gcloud: command not found` (cold start), run `bash skills/gcloud/scripts/install.sh` first (idempotent).

## IAM the bound service account needs

`gcloud compute ssh` authenticates as the impersonated bound SA. Grant it, on the target project (least privilege — add only what's missing):

| Purpose | Role |
|---|---|
| Look up the instance | `roles/compute.viewer` (or just `compute.instances.get`) |
| Log in **without** sudo | `roles/compute.osLogin` |
| Log in **with** sudo (needed for `sudo …`, installs) | `roles/compute.osAdminLogin` |
| Use a VM that runs as a service account | `roles/iam.serviceAccountUser` **on the VM's attached SA** |
| Tunnel through IAP (VM without external IP) | `roles/iap.tunnelResourceAccessor` |

Plus, **on the VM or its project**:
- **OS Login must be on** — `enable-oslogin=TRUE` in instance or project metadata. Without it sshd reads `~/.ssh/authorized_keys` and the synthetic OS Login user (`sa_<id>`) doesn't exist → every login fails with `Permission denied (publickey)`. (`enable-oslogin-2fa` only enforces 2FA on **human** identities — service accounts are exempt, so it does not block this SA path.)
- **Firewall** — allow ingress tcp:22 from the IAP range **`35.235.240.0/20`** when tunneling through IAP, or from your egress range when using a public IP.

Grant example (run by the user / a team admin with their own gcloud, or via the `gcloud` skill after confirmation):

```bash
sa="serviceAccount:<bound-sa-email>"
# Instance lookup + login. Default to osLogin (no sudo); swap to osAdminLogin
# ONLY when the task actually runs sudo/root commands.
gcloud projects add-iam-policy-binding <project> --member="$sa" --role="roles/compute.viewer"
gcloud compute instances add-iam-policy-binding <vm> --zone <zone> --project <project> \
  --member="$sa" --role="roles/compute.osLogin"   # or roles/compute.osAdminLogin for sudo
# If the VM runs as a service account, grant serviceAccountUser on THAT SA.
gcloud iam service-accounts add-iam-policy-binding <vm-attached-sa-email> --project <project> \
  --member="$sa" --role="roles/iam.serviceAccountUser"
# IAP tunnel (VM without an external IP).
gcloud projects add-iam-policy-binding <project> \
  --member="$sa" --role="roles/iap.tunnelResourceAccessor"
```

## Run a command

Use the bundled wrapper — it sets the non-interactive SSH flags (`BatchMode`, `StrictHostKeyChecking=accept-new`, a connect timeout), tunnels through IAP by default, and passes the remote command's exit code straight back:

```bash
# Single command (IAP tunnel on by default; project comes from the pinned gcloud config)
bash skills/gcp-compute-engine-ssh/scripts/gce-ssh.sh <vm> <zone> 'df -h && systemctl is-active nginx'

# VM has a public IP and IAP isn't set up → skip the tunnel
NO_IAP=1 bash skills/gcp-compute-engine-ssh/scripts/gce-ssh.sh <vm> <zone> 'uptime'

# Cross-project in one turn → pin the project explicitly
GCE_PROJECT=<project-id> bash skills/gcp-compute-engine-ssh/scripts/gce-ssh.sh <vm> <zone> 'whoami'
```

Pipe a **multi-line script** over stdin (the loki install pattern) — `bash -s` reads it, `sudo` if it must run as root:

```bash
gcloud compute ssh <vm> --zone <zone> --tunnel-through-iap --quiet \
  --command "sudo -n bash -s" \
  -- -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 \
  < path/to/local-script.sh
```

`sudo -n` fails fast instead of hanging on a password prompt, and the `-- -o …`
options keep the direct call as non-interactive as the wrapper.

Prefer piping over stdin to embedding a huge script in `--command` (quoting/length limits). The wrapper is for single commands; go direct for stdin.

## Troubleshooting

- **`Permission denied (publickey)`** → OS Login not enabled, or the SA lacks `roles/compute.osLogin`/`osAdminLogin`, or the key hasn't propagated yet (first connect after a grant can take a few seconds — retry once). Check `enable-oslogin` metadata.
- **`Connection timed out` / `port 22`** → no route. With `--tunnel-through-iap`, add the `35.235.240.0/20` firewall rule and grant `roles/iap.tunnelResourceAccessor`. Without IAP, the VM needs a public IP and a `22` ingress rule.
- **`sudo: a password is required`** → the SA has `osLogin` but not `osAdminLogin`; grant admin login for privileged commands.
- **`Your active configuration is …` / reauth / `invalid_grant`** → the impersonated token expired (~1h). Re-run the `gcloud` `setup-credentials.sh`.

## Safety

- **Confirm before every mutating command on a customer VM.** Reads (`cat`, `df`, `systemctl status`, `journalctl`) are fine to run once identity is confirmed; anything that writes, installs, restarts, or deletes needs the user's explicit go-ahead with the exact VM + command named first.
- **Least privilege** — request `osLogin` (no sudo) unless the task genuinely needs root; only ask for `osAdminLogin` when a `sudo` step is required.
- **Don't leave keys/firewall openings behind.** OS Login keys `gcloud` pushes are short-lived; if you add a firewall rule to make a VM reachable, tell the user and offer to remove it after.
- **Never print the impersonated token** — it lives under `~/.config/gcloud/`; let `gcloud` read it, don't `cat` it back.
