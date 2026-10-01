---
name: hetzner
description: Run hcloud CLI commands from the sandbox to inspect or change Hetzner Cloud resources — servers, volumes, networks, firewalls, load balancers, floating IPs, and images. Includes a setup script for selected Nuphos-bound Hetzner accounts.
---

# Hetzner Cloud CLI

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill when the user wants to inspect or change Hetzner Cloud resources
directly with `hcloud`, including servers, volumes, networks, firewalls, load
balancers, floating IPs, SSH keys, and images.

Hetzner Cloud has no managed Kubernetes offering (there is no LKE/GKE/EKS
equivalent), so there are no managed clusters or kubeconfigs to fetch here. If a
user runs Kubernetes on Hetzner, it is self-managed on their servers — inspect
it with `kubectl` using a kubeconfig they provide, not through this skill.

The CLI is pre-installed in the sandbox runtime image. If it is missing, tell
the user the runtime image is missing `hcloud`; do not conclude that Nuphos
lacks Hetzner credentials.

## Prefer Nuphos API for first-party reads

For read-only data Nuphos already exposes, call the Nuphos API first. This list
route wraps its result in an object, so extract the array before piping to a
`jq` filter (e.g. `.servers[]`, not `.[]`):

```bash
ac /teams/<teamId>/hetzner-accounts                      # -> { "accounts": [...] }
ac /teams/<teamId>/hetzner-accounts/<accountId>/servers  # -> { "servers": [...] }

# list servers as id + name + status + location:
ac /teams/<teamId>/hetzner-accounts/<accountId>/servers \
  | jq -r '.servers[] | "\(.id)\t\(.name)\t\(.status)\t\(.location)"'
```

Use `hcloud` for details or operations not covered by that route.

## Setup

Authenticate before any `hcloud` call:

```bash
bash skills/hetzner/scripts/setup-credentials.sh <teamId> <accountId>
```

The setup script uses the selected account for this agent session when
`NUPHOS_SESSION_ID` is present, writes `~/.config/hcloud/cli.toml` with an
active context, and also writes `~/.hetzner/nuphos.env` exporting `HCLOUD_TOKEN`
for tools that read it from the environment. `hcloud` prefers `HCLOUD_TOKEN`
when it is set, so `source ~/.hetzner/nuphos.env` if a later shell doesn't pick
up the context.

Confirm the token works before mutating anything:

```bash
hcloud server list -o json
```

## Common operations

```bash
hcloud server list -o json
hcloud server describe <server-id-or-name> -o json
hcloud volume list -o json
hcloud network list -o json
hcloud firewall list -o json
hcloud load-balancer list -o json
hcloud floating-ip list -o json
hcloud image list -o json
```

If `hcloud` returns auth errors, re-run the setup script before asking the user
for a token.

## Safety

- Read-only by default. `list` and `describe` are safe.
- Confirm with the user before mutations such as create, delete, poweroff,
  reboot, rebuild, resize (`change-type`), attach, detach, enable-protection, or
  disable-protection.
- Do not print the Hetzner token, `cat ~/.config/hcloud/cli.toml`, or echo
  `HCLOUD_TOKEN`.
- If a requested Hetzner account is not listed in the enabled credentials
  prompt, ask the user to update this session's credential selection.
