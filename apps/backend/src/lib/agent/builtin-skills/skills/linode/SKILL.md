---
name: linode
description: Run linode-cli commands from the sandbox to inspect or change Linode/Akamai Cloud resources, including LKE clusters. Includes a setup script for selected Nuphos-bound Linode accounts.
---

# Linode CLI

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill when the user wants to inspect or change Linode/Akamai Cloud resources directly with `linode-cli`, including Linode instances, LKE clusters, NodeBalancers, firewalls, volumes, object storage, images, and account events.

The CLI is pre-installed in the sandbox runtime image. If it is missing, tell the user the runtime image is missing `linode-cli`; do not conclude that Nuphos lacks Linode credentials.

## Prefer Nuphos API for first-party reads

For read-only data Nuphos already exposes, call the Nuphos API first. These list
routes wrap their results in an object, so extract the array before piping to a
`jq` filter (e.g. `.clusters[]`, not `.[]`):

```bash
ac /teams/<teamId>/linode-accounts                          # -> { "accounts": [...] }
ac /teams/<teamId>/linode-accounts/<accountId>/instances    # -> { "instances": [...] }
ac /teams/<teamId>/linode-accounts/<accountId>/lke-clusters # -> { "clusters": [...] }

# list LKE clusters as id + label + region:
ac /teams/<teamId>/linode-accounts/<accountId>/lke-clusters \
  | jq -r '.clusters[] | "\(.id)\t\(.label)\t\(.region)"'
```

Use `linode-cli` for details or operations not covered by those routes.

## Setup

Authenticate before any `linode-cli` call:

```bash
bash skills/linode/scripts/setup-credentials.sh <teamId> <accountId>
```

The setup script uses the selected account for this agent session when `NUPHOS_SESSION_ID` is present, writes `~/.config/linode-cli`, and also writes `~/.linode/nuphos.env` for tools that prefer `LINODE_CLI_TOKEN`.

Confirm identity before mutating anything:

```bash
linode-cli profile view --json
```

## Common operations

```bash
linode-cli linodes list --json
linode-cli linodes view <linode-id> --json
linode-cli lke clusters-list --json
linode-cli lke cluster-view <cluster-id> --json
linode-cli lke kubeconfig-view <cluster-id> --text
linode-cli nodebalancers list --json
linode-cli firewalls list --json
linode-cli events list --json
```

`linode-cli` may print a version-skew banner (`The API responded with version
…`) on stderr. Do **not** merge stderr into the pipe when feeding `--json` to
`jq` — `linode-cli ... --json 2>&1 | jq` makes `jq` choke on the banner with
`parse error: Invalid numeric literal`. Drop the `2>&1` (or use `2>/dev/null`).

If `linode-cli` returns auth errors, re-run the setup script before asking the user for a token.

## Inspecting an LKE cluster with kubectl

Every LKE cluster this session can reach is a context named
`linode/<account>/<cluster>` in the kubeconfig the `kubectl` skill sets up.

```bash
kubectl config get-contexts
kubectl --context linode/prod/my-cluster get ns
```

Note: LKE API servers may sit behind an IP allowlist, so `kubectl` can hang/time
out from the sandbox. If it does, fall back to the `linode-cli`/Nuphos API reads
above rather than retrying `kubectl`.

## Safety

- Read-only by default. `list`, `view`, and `events list` are safe.
- Confirm with the user before mutations such as create, update, delete, rebuild, reboot, resize, assign, attach, detach, or kubeconfig-changing operations.
- Do not print the Linode token, `cat ~/.config/linode-cli`, or echo `LINODE_CLI_TOKEN`.
- If a requested Linode account is not listed in the enabled credentials prompt, ask the user to update this session's credential selection.
