---
name: setup-aws-iam
description: Connect a new AWS account to Nuphos using the user's LOCAL aws cli. Walks through listing roles, granting the Nuphos connector trust, and binding the role via the create_connector MCP tool. Use when a user wants to onboard / bind an AWS account and has aws cli configured on their own machine.
---

# Setup AWS IAM (local aws cli)

Use this skill to onboard a fresh AWS account into Nuphos end-to-end, driven by
the **user's own `aws` cli** on their local machine. The end state is an AWS
role that the Nuphos connector can assume, registered as a team binding.

This is the bootstrap path for an account Nuphos is **not yet connected to**.
Once a role is bound, use the `aws` skill (sandbox, Nuphos-minted creds) for
day-to-day operations instead.

## CRITICAL — two execution environments

This flow spans two different tools. Getting this wrong is the #1 failure mode:

| Steps | Tool | Credentials | Why |
| --- | --- | --- | --- |
| 1–3 (list roles, set trust policy) | **`local_exec`** | the user's local `~/.aws` (their IAM-admin identity) | The account isn't bound yet, so the sandbox cannot mint creds for it. Only the user's own cli can read/modify IAM here. |
| 4 (bind) | **`create_connector` MCP tool** | current conversation’s user and team | Reuses the Add connector validation and saves the connection directly. |

Do **not** try to run the IAM setup commands through the sandbox `bash` tool —
the sandbox has no access to the user's local AWS credentials. Run every
step-1-to-3 command via the `local_exec` tool.

## How the Nuphos connector authenticates

Nuphos uses OIDC web-identity federation. It pins the role to the user's team
cryptographically (AWS verifies the `sub` claim in a Nuphos-signed token), so no
other team can assume the role through Nuphos and no long-lived AWS credentials
exist anywhere in the chain.

Discover the issuer first: `GET /.well-known/openid-configuration` on the
Nuphos API base URL returns `{ "issuer": "https://<issuer-host>", ... }`. A
404 with `oidc_not_configured` means AWS account binding is unavailable on that
server until its OIDC signing key is configured. You also need the user's
**team id** (the hex id from `/teams`).

The customer account needs (a) an IAM OIDC identity provider for the issuer
(one per AWS account), and (b) a role trusting it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<customer-account-id>:oidc-provider/<issuer-host>"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "<issuer-host>:aud": "sts.amazonaws.com",
          "<issuer-host>:sub": "nuphos:team:<team-id>"
        }
      }
    }
  ]
}
```

The `sub` condition is the security boundary — never write it with a wildcard
or omit it.

## Workflow

### 1. Confirm the local identity and target account (`local_exec`)

```bash
aws sts get-caller-identity
```

Show the user the `Account` and `Arn`. Confirm this is the account they want to
connect and that the identity can manage IAM (create/update roles). If the wrong
account/profile is active, ask them to set `AWS_PROFILE` or `--profile` and stop.

### 2. List existing roles (`local_exec`)

```bash
aws iam list-roles --query 'Roles[].RoleName' --output text
# Inspect one role's current trust policy before touching it:
aws iam get-role --role-name <name> \
  --query 'Role.AssumeRolePolicyDocument'
```

### 3. Grant the Nuphos connector trust (`local_exec`)

**Prefer a dedicated role.** Widening an existing high-privilege role's trust to
an external principal is risky — recommend creating a purpose-built role unless
the user insists on an existing one.

**Create a dedicated role with OIDC trust:**

```bash
# One-time per AWS account — register the Nuphos OIDC provider. If it already
# exists (EntityAlreadyExists), reuse it.
aws iam create-open-id-connect-provider \
  --url https://<issuer-host> \
  --client-id-list sts.amazonaws.com

cat > /tmp/nuphos-trust.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<customer-account-id>:oidc-provider/<issuer-host>"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "<issuer-host>:aud": "sts.amazonaws.com",
          "<issuer-host>:sub": "nuphos:team:<team-id>"
        }
      }
    }
  ]
}
JSON

aws iam create-role \
  --role-name nuphos-connector \
  --assume-role-policy-document file:///tmp/nuphos-trust.json \
  --description "Assumed by the Nuphos BYOS connector (OIDC web identity)"

# Attach whatever permissions Nuphos should have. Scope to least privilege;
# confirm the policy set with the user before attaching. Example (read-only):
aws iam attach-role-policy --role-name nuphos-connector \
  --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
```

**Or add OIDC trust to an existing role (only if requested):**

`update-assume-role-policy` **replaces** the whole trust document. Never clobber
existing trusted principals — fetch the current policy with `get-role` (step 2),
merge the Nuphos principal in, then write the merged document back. Warn the user
that this widens who can assume that role.

After either option, capture the role ARN:

```bash
aws iam get-role --role-name nuphos-connector --query 'Role.Arn' --output text
```

### 4. Finish the connection (`create_connector` MCP)

Once the requested role is ready, call `create_connector` with a short `label` and:

```json
{
  "connector": {
    "provider": "aws",
    "roleArn": "arn:aws:iam::<account>:role/nuphos-connector"
  }
}
```

The current conversation supplies the team and acting user. The user must be a
team **ADMINISTRATOR**. Do not ask them to copy the ARN or press Add connector;
their request to connect the account includes this final registration step.
Never submit access keys, tokens, or a different team ID to the tool.

The backend **verifies it can actually assume the role before it persists the
binding** using OIDC web identity — the only way Nuphos assumes an AWS role.
It retries briefly for IAM propagation. If it returns `400 role_not_assumable`, the trust
policy from step 3 hasn't propagated or is wrong — wait a few seconds and retry,
or re-check the trust document; the `sub` must be exactly
`nuphos:team:<team-id>` for the binding team. A successful tool result means the binding is live
and already assume-verified.

### 5. Confirm it works

Round-trip a read route on the new account to prove end-to-end access, e.g.:

```bash
ac /teams/$TEAM/aws-accounts | python3 -m json.tool
# or list the account's EKS clusters via the documented route
```

## Safety

- **Never run IAM-mutating commands without the user's explicit go-ahead.**
  Summarize the exact role name, trust principal, and attached policies first.
- **`create-role` / `attach-role-policy` / `update-assume-role-policy` are
  mutations** — they happen on the user's real account via their own creds.
  Treat them like any other confirmed write.
- **Least privilege.** Don't default to `AdministratorAccess`. Propose the
  narrowest managed/custom policy that satisfies what the user wants Nuphos to do.
- **Don't echo secrets.** If any command surfaces keys or tokens, summarize
  rather than printing them.
