---
name: aws-ec2-ssh
description: Run shell commands on a bound AWS EC2 instance from the sandbox. Prefers SSM Run Command / Session Manager (no open port, no key, structured output — the AWS best practice) and falls back to EC2 Instance Connect for real SSH (public IP, or private via an EC2 Instance Connect Endpoint). Covers credential setup, the exact IAM the bound role needs, and troubleshooting.
---

# EC2 — run commands on a bound instance

Use this skill when the user wants to **execute commands on a specific EC2 instance** in a bound AWS account — diagnostics, reading a log, or piping a script onto the box.

There are two channels. **Default to SSM** — it needs no open inbound port, no key, and returns structured stdout/stderr/exit code; it's the AWS-recommended path and the right one for an agent. Use **SSH (EC2 Instance Connect)** only when the user specifically needs an SSH session or SSM isn't available on the instance.

## When to skip this skill

- **Data Nuphos already exposes** (list instances, VPCs, security groups) → the backend routes or the `aws` skill's read commands. Don't connect just to read metadata.
- **Fleet log collection** → use the `loki` skill.
- **Interactive shell for a human** → the desktop terminal, not the agent.

## Access layer — authenticate first

Credentials come from the **`aws` skill** — this skill does not re-mint them. The AWS role must be enabled in this session's credential selector.

```bash
# Short-lived STS creds for the bound account → ~/.aws/credentials + config.
bash skills/aws/scripts/setup-credentials.sh <teamId> <accountId> [region]

aws sts get-caller-identity      # confirm account/role before anything
# resolve the instance id if the user gave a Name tag / IP:
aws ec2 describe-instances --region <region> \
  --query 'Reservations[].Instances[].[InstanceId,State.Name,PrivateIpAddress,PublicIpAddress,Tags[?Key==`Name`]|[0].Value]' \
  --output table
```

If `aws: command not found` (cold start), run `bash skills/aws/scripts/install.sh` first (idempotent).

---

## Channel A (preferred) — SSM Run Command / Session Manager

No inbound port, no SSH key, IAM-gated, CloudTrail-audited. **Requirements on the instance:** the **SSM Agent** running (pre-installed on Amazon Linux 2/2023 and Ubuntu AMIs) and an **instance profile** with `AmazonSSMManagedInstanceCore`. Confirm reachability first:

```bash
aws ssm describe-instance-information --region <region> \
  --filters "Key=InstanceIds,Values=<instance-id>" --output table
# empty result → the instance isn't registered with SSM (no agent or no instance profile) → use Channel B
```

**IAM the bound role needs** (caller side):
- `ssm:SendCommand`, `ssm:GetCommandInvocation`, `ssm:DescribeInstanceInformation` — for Run Command (non-interactive; **use this for the agent**)
- `ssm:StartSession` (+ terminate) — for an interactive Session Manager shell
- (interactive SSH-over-SSM only) `ssm:StartSession` on document `AWS-StartSSHSession`

Run a command and get its output — the wrapper sends `AWS-RunShellScript`, polls to completion, prints stdout/stderr, and exits with the remote exit code:

```bash
bash skills/aws-ec2-ssh/scripts/ssm-run.sh <instance-id> <region> 'df -h && systemctl is-active nginx'
```

> Note: SSM `get-command-invocation` caps inline output at ~2500 chars. For longer output the wrapper warns; re-run with `SSM_S3_BUCKET=<bucket>` to capture full output to S3, or narrow the command.

Interactive session (rarely needed by the agent):

```bash
aws ssm start-session --target <instance-id> --region <region>
```

---

## Channel B (fallback) — EC2 Instance Connect (real SSH)

Pushes a **60-second** ephemeral public key, then connects over SSH. Use when the user needs SSH specifically or SSM isn't on the box.

**Requirements on the instance:** the `ec2-instance-connect` package (pre-installed on AL2/AL2023 and Ubuntu 20.04+) and a security group allowing tcp:22 from your source. **Public IP** → connect directly. **Private subnet, no public IP** → go through an **EC2 Instance Connect Endpoint (EICE)** — no bastion, no public IP needed.

**IAM the bound role needs:**
- `ec2-instance-connect:SendSSHPublicKey`, `ec2:DescribeInstances`, `ec2:DescribeImages` (the wrapper reads the AMI description to guess the OS user)
- (private via EICE) also `ec2-instance-connect:OpenTunnel`

The wrapper generates an ephemeral key, pushes it, and runs your command over SSH — direct for a public IP, or `--eice` to tunnel through an endpoint:

```bash
# public IP
bash skills/aws-ec2-ssh/scripts/eic-ssh.sh <instance-id> <region> 'uptime'
# private instance, via EC2 Instance Connect Endpoint
EICE=1 bash skills/aws-ec2-ssh/scripts/eic-ssh.sh <instance-id> <region> 'uptime'
# override the guessed OS user (default ec2-user / ubuntu by AMI)
SSH_USER=ubuntu bash skills/aws-ec2-ssh/scripts/eic-ssh.sh <instance-id> <region> 'whoami'
```

Pipe a multi-line script over stdin (append `< script.sh` — the wrapper forwards stdin to the remote shell).

---

## Choosing a channel

1. `describe-instance-information` returns the instance → **Channel A (SSM)**. Best for the agent: structured output, no port, no key.
2. Not in SSM but reachable on 22 → **Channel B**, direct.
3. Private, no public IP, has an EICE → **Channel B with `EICE=1`**.
4. None of the above → tell the user what's missing (install SSM Agent + attach `AmazonSSMManagedInstanceCore`, or open 22 / add an EICE); don't invent a bastion.

## Troubleshooting

- **SSM `InvalidInstanceId` / not in `describe-instance-information`** → SSM Agent not running or no instance profile with `AmazonSSMManagedInstanceCore`. Attach the policy to the instance role and reboot, or use Channel B.
- **SSM command stuck `Pending`/`InProgress`** → the wrapper polls with a bounded loop; if it times out the command may still finish — re-check with `aws ssm get-command-invocation --command-id <id> --instance-id <id>`.
- **EIC `AuthFailure`/`Permission denied (publickey)`** → key expired (60 s window — the wrapper pushes right before connecting, so retry once), wrong OS user (`SSH_USER=`), or the `ec2-instance-connect` package missing.
- **EIC `Connection timed out`** → security group doesn't allow tcp:22 from your source; for a private instance you need `EICE=1`.
- **`ExpiredToken`** → the STS creds expired (~1h). Re-run the `aws` `setup-credentials.sh`.

## Safety

- **Confirm before every mutating command on a customer instance.** Reads are fine once identity is confirmed; writes/installs/restarts/deletes need explicit go-ahead with the exact instance + command named first.
- **Prefer SSM over opening ports.** Don't add a `22` ingress rule to make SSH work if SSM is available; if you must open one, tell the user and offer to remove it after.
- **Least privilege** — request only the IAM actions the chosen channel needs; don't ask for `StartSession` if Run Command suffices.
- **Don't echo credentials or private keys.** The ephemeral SSH key is written to a tmpfile and removed by the wrapper; STS creds live in `~/.aws/`.
