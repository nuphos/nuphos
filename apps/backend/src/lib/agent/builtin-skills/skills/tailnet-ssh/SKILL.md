---
name: tailnet-ssh
description: Run commands on on-premises machines that are only reachable inside a customer's Tailscale tailnet. Joins the sandbox to the tailnet as a short-lived node, then uses ordinary SSH over it. Covers the auth model, the ACL the customer must have in place, the approval prompt, and troubleshooting.
---

# tailnet-ssh — reach machines inside a customer's private network

Use this skill when the target machine has **no public SSH** and lives in the
customer's own data centre or office, reachable only through their Tailscale
tailnet.

The sandbox joins the tailnet as an ephemeral node tagged with a tag the
customer controls, then SSH runs over that. The node disappears when the
session ends.

## When to skip this skill

- **Cloud VMs** → `aws-ec2-ssh` or `gcp-compute-engine-ssh`. They have better
  channels (SSM, IAP) that need no network membership at all.
- **Reading tailnet metadata** (devices, ACLs, DNS) → the `tailscale` skill.
  Do not join the tailnet just to list machines.
- **Databases on the tailnet** → the database tools already route through the
  backend's tailnet dialer. Do not SSH to run a query.

## Authorization model — read before troubleshooting

Three independent gates, all on the customer's side or the user's:

1. An administrator enabled **private network access** on the Tailscale binding
   in Nuphos, and chose the tag the sandbox advertises.
2. The binding is selected in **this session's credential selector**.
3. The customer's **tailnet ACL** grants that tag access to the target, and an
   `ssh` rule permits the login user.

Gate 3 is the real boundary and Nuphos cannot influence it. If a host is
unreachable, the ACL is the first thing to suspect — not the connection.

The sandbox connects as a **tagged node**, not as a person. Tailscale's
interactive `check` approval does not apply to tagged sources, so there is no
per-connection browser prompt on the customer's side. Where a human gate is
required it comes from Nuphos's own approval flow, and the customer's
enforceable control is session recording.

## Connect

```bash
bash skills/tailnet-ssh/scripts/connect.sh <teamId> <clientId>
```

Idempotent: safe to re-run, and a no-op once joined. It prints the reachable
peers with their tailnet addresses — use those, or the full `*.ts.net` name.
Short MagicDNS names do not resolve from the sandbox.

Then use plain SSH:

```bash
ssh deploy@100.101.102.103 'systemctl is-active nginx'
ssh deploy@web-01.tailnet-name.ts.net 'df -h'
```

Non-SSH tools can use the SOCKS5 proxy the script prints (default
`127.0.0.1:1055`), for example `curl --proxy socks5h://127.0.0.1:1055 …`.

## Never create SSH keys

Authentication is **Tailscale SSH**: the target authenticates this node's
tailnet identity, so there is no key to install and none to manage. If SSH asks
for a password or a key, that host does not have Tailscale SSH enabled — say so
and stop. Do not generate a keypair, do not ask the user for a private key, and
do not edit `authorized_keys` to work around it.

## Session recording may be mandatory

The customer's `ssh` rule can set `enforceRecorder`, which records every session
to a recorder inside their own network and **refuses the connection outright if
that recorder is unreachable**.

So a connection failing with a recorder error is infrastructure on their side,
not a permission problem. Report it as such. Never look for an unrecorded route
in — there isn't one, and trying is exactly the behaviour the control exists to
prevent.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `tailscale_sandbox_access_disabled` | No administrator has enabled private network access on this binding. |
| `tailscale_client_agent_access_denied` | The binding is not selected in this session's credential selector. |
| `tailscale_auth_key_denied` | The customer's OAuth client lacks the `auth_keys` scope, or does not own the configured tag. |
| Joins, but no peers listed | The ACL grants this tag nothing. The customer needs a `grants` entry with this tag as `src`. |
| Peer listed, SSH times out | The ACL allows discovery but not port 22, or the host is not running tailscaled. |
| SSH asks for a password | Tailscale SSH is not enabled on that host. Do not fall back to keys. |
| `tailscaled did not start` | Re-run; if it persists, report it. Do not try to install a different networking mode — userspace is the only one the sandbox can use. |

## Disconnect

```bash
bash skills/tailnet-ssh/scripts/disconnect.sh
```

Rarely needed — the node is ephemeral and is reaped when the sandbox ends.
