# Skills store (ZEA-10066 / ZEA-10121 / ZEA-10153)

> **Status:** Implemented for **hosted Nuphos** (single process-level S3 bucket +
> prefix isolation). **Self-host** works via the same env vars. **Per-team BYOS
> storage** is intentionally not built yet; the scope/merge/API surface is
> shaped so a later provider resolution layer can plug in without rewriting
> product routes or agent tools.
>
> **Default product path = Mode 1** (our backend + our bucket). Mode 2 is
> config-only self-host. Mode 3 (hosted API + customer bucket) is opt-in later,
> never the platform default.
>
> Related: file-transfer storage seam (`lib/storage/`, ZEA-9910) — same “default
> Zeabur bucket now, team BYOS later” pattern. Provider entry point:
> `getSkillsStore({ teamId?, scope? })` in `skills-s3.ts`.

## Goals

- Ship **team-shared, editable agent skills** (playbooks, runbooks) that every
  chat in a team can load via `skill()`.
- Keep **builtin skills** in the repo (versioned with the backend).
- Optionally overlay **global** skills shared across all teams on a deployment.
- Fail closed when the store is unconfigured: team skills UI and mutating
  agent tools stay disabled; chats still get builtin skills only.
- Record trusted creator/updater provenance, monotonically increasing package
  revisions, tombstones, and append-only mutation outcomes without copying
  skill bodies into MongoDB or the audit log.

## Non-goals (current)

- Per-team customer-owned buckets (BYOS skills) — design only, see [Deployment modes](#deployment-modes).
- Multi-region active-active skill replication.
- Overwriting **builtin** skill names from global/team overlays
  (`assertSkillNameNotBuiltinOverlay`).
- Storing secrets inside skill files (agent tools reject common secret patterns).

---

## Layer model

| Layer       | Source                              | Identity                     | Mutability             |
| ----------- | ----------------------------------- | ---------------------------- | ---------------------- |
| **Builtin** | `lib/agent/builtin-skills/skills/`  | Repo path                    | Code deploy only       |
| **Global**  | S3 `global/skills/<name>/…`         | Scope `global`               | Admin API              |
| **Team**    | S3 `teams/<teamId>/skills/<name>/…` | Scope `teams/<teamObjectId>` | Team API + agent tools |

**Merge precedence** when materializing the directory used by the agent and sandbox:

```text
team  >  global  >  builtin
```

Same skill **name** in a higher layer replaces the lower layer’s tree (copy
overlay). An empty team skill directory does **not** shadow a lower layer
(merge only overlays directories that have a valid skill).

Implementation: `lib/agent/skill-store/merge.ts` →
`materializeMergedSkillsDir` / `resolveSkillsDirectory`.

---

## Scope and object keys

A **scope** is a logical namespace, not a storage backend:

- `global`
- `teams/<teamId>` where `teamId` is the MongoDB team ObjectId hex string

Helpers: `normalizeSkillScope`, `skillScopeS3Prefix`, `skillObjectKey` in
`lib/agent/skill-store/scope.ts`.

### S3 layout (hosted / single-bucket)

```text
s3://$ATLAS_SKILLS_BUCKET/
  global/
    skills/
      <skill-name>/
        SKILL.md          # required for a “real” skill in the manifest
        scripts/…
        references/…
  teams/
    <teamObjectId>/
      skills/
        <skill-name>/
          SKILL.md
          …
```

- Full object key: `{scope}/skills/<name>/<relativePath>`
- API keys are **scope-relative**: always start with `skills/…`
  (`SKILL_OBJECT_KEY_PREFIX`).
- Team isolation = **prefix isolation** on one shared bucket (not separate
  IAM principals per team today).

### Local cache

| Path                                             | Meaning                                                        |
| ------------------------------------------------ | -------------------------------------------------------------- |
| `$ATLAS_SKILLS_CACHE_DIR/<scope segments>/…`     | Synced objects for one scope (e.g. `…/global`, `…/teams/<id>`) |
| `$ATLAS_SKILLS_CACHE_DIR/.merged/team-<teamId>/` | Materialized merge for agent use                               |
| `$ATLAS_SKILLS_CACHE_DIR/.merged/solo/`          | Merge without team context                                     |

Sync writes a per-scope manifest (revision token used for merge cache
invalidation). See `sync.ts` / `getScopeSyncRevision`.

### Provenance and audit data

S3 remains authoritative for skill file bytes. MongoDB stores two derived,
trusted collections:

| Collection      | Purpose                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `skill_records` | Current package projection: scope/name, creator/updater, source, revision, active/deleted status, tombstone data, idempotency receipts |
| `skill_events`  | Append-only intent/result events: actor, source, changed keys, status, before/after ETags, request/conversation/tool ids, error        |

Full skill bodies are never written to either collection. Each logical
mutation writes an intent before S3 and a result afterward. A stable mutation
id makes retries revision-idempotent. Multi-file writes restore prior S3 bytes
on failure; partial rollback/delete outcomes are recorded as `partial`.

Old S3-only packages are reported as `legacy` with `createdByUserId = null`,
`createdAt = null`, and `revision = 0`; the system deliberately does not infer
an original creator from object ownership or current team membership.

---

## Configuration

Process-level env (see `apps/backend/.env.example` and `config.skillsStore`):

| Variable                            | Required              | Default                                                     |
| ----------------------------------- | --------------------- | ----------------------------------------------------------- |
| `ATLAS_SKILLS_BUCKET`               | Yes (to enable store) | unset → store disabled                                      |
| `ATLAS_SKILLS_S3_ACCESS_KEY_ID`     | Yes                   | —                                                           |
| `ATLAS_SKILLS_S3_SECRET_ACCESS_KEY` | Yes                   | —                                                           |
| `ATLAS_SKILLS_S3_REGION`            | No                    | `us-east-1`                                                 |
| `ATLAS_SKILLS_CACHE_DIR`            | No                    | `$TMPDIR/nuphos-skills-cache` or `/tmp/nuphos-skills-cache` |

Configured iff **bucket + access key id + secret** are all set
(`isSkillsStoreConfigured`).

Unset / incomplete →:

- HTTP handlers throw `skills_store_unconfigured` (503).
- Desktop Team Skills UI shows “Skills store is not configured”.
- `createTeamSkillTools` returns no tools.
- `resolveSkillsDirectory` falls back to **builtin only**.

Production (hosted): set these on the backend deployment env
(`atlas-backend-env` / Deployment for `nuphos-backend` in EKS `production`).
Public API origin: `https://api.nuphos.ai`.

---

## HTTP surface

### Team (product)

Mounted at `/teams/:teamId/skills` (`routes/team-skills.ts`).

Scope is **always** derived from the authenticated team id:

`teamSkillsScope(teamId)` → `teams/<teamId>`  
Callers cannot pass an arbitrary scope on team routes.

| Method | Path             | Roles                 | Purpose                                     |
| ------ | ---------------- | --------------------- | ------------------------------------------- |
| GET    | `/manifest`      | member                | List skills + orphans                       |
| GET    | `/objects`       | member                | Flat object list                            |
| GET    | `/object?key=`   | member                | Detail + presigned download                 |
| GET    | `/history?name=` | member                | Provenance projection + append-only history |
| POST   | `/object`        | ADMINISTRATOR, EDITOR | Upload body (`key` + `file`)                |
| DELETE | `/object?key=`   | ADMINISTRATOR         | Delete one object                           |
| DELETE | `/skill?name=`   | ADMINISTRATOR         | Delete entire skill tree                    |

Limits (service constants): max upload **10 MiB**, list cap **5000** objects,
inline text preview **200 KiB**, presign TTL **900s**.

### Admin

Mounted under admin at `/skills` (`routes/admin-skills.ts`).

- Explicit `scope` query/body (can target `global` or any `teams/<id>`).
- Lists scopes discovered from S3 common prefixes.
- Nuphos admins manage global skills and may inspect/update team scopes. A
  team `ADMINISTRATOR` role applies only to that team scope; it does not grant
  global-skill authority.

### Audit Log

Desktop Audit Log **All events** merges result rows from `skill_events` with
the Agent Journal using one timestamp/source/ObjectId cursor. Direct desktop
or admin changes remain resource events and are not represented as fake
conversations. The Conversations tab remains Agent Journal-only.

### Agent tools

`lib/agent/tools-team-skills.ts` — only when:

1. `teamId` present
2. store configured
3. session origin is not `trigger`
4. user is team member and not VIEWER

Writes only to `teams/<teamId>/…`. Builtin names are reserved.

---

## Runtime path (chat)

```text
agent session (teamId)
  → resolveSkillsDirectory(teamId)
      → syncScope('global')
      → syncScope('teams/' + teamId)   // if teamId
      → materializeMergedSkillsDir(teamId)   // team > global > builtin
  → inject into sandbox / skill() tool root
```

Transient S3 sync failures: best-effort fall through to last cached revision
or builtin-only (see `resolveSkillsDirectory` try/catch).

---

## Skill package shape

- Directory name: `[a-zA-Z0-9][a-zA-Z0-9._-]*`
- `SKILL.md` with YAML frontmatter at minimum:

  ```yaml
  ---
  name: deploy-checklist
  description: One-line registry description
  ---

  Markdown body…
  ```

- Optional sibling files under the skill directory (scripts, references).
- Objects not under a skill dir or missing `SKILL.md` grouping appear as
  **orphans** in the manifest.

---

## Deployment modes

Three product situations. **Mode 1 is the default** for Nuphos customers.

### Mode 1 — Hosted Nuphos (**default**)

|                  |                                                   |
| ---------------- | ------------------------------------------------- |
| Backend          | Nuphos-managed (`api.nuphos.ai`)                  |
| Bucket           | Nuphos/Zeabur-owned S3                            |
| Tenant isolation | `teams/<teamId>/` prefix                          |
| Global skills    | Shared `global/` on same bucket                   |
| Customer action  | None (env owned by operators)                     |
| Seed / ops       | `bun run skills:upload -- --scope global --dir …` |

This is the supported production path once `ATLAS_SKILLS_*` is set on the
hosted backend (ops: ZEA-10120).

### Mode 2 — Full self-host (config today)

|           |                                                       |
| --------- | ----------------------------------------------------- |
| Backend   | Customer-run `apps/backend`                           |
| Bucket    | Customer provisions any S3-compatible bucket          |
| Env       | Same `ATLAS_SKILLS_*` on that process                 |
| Isolation | Same prefix model if one deployment serves many teams |
| Desktop   | Point `NUPHOS_API_URL` at the self-hosted API         |

No product code change required. Operators supply credentials and (optionally)
seed skills via `scripts/upload-skills.ts`, admin `/skills`, or AWS CLI.

### Mode 3 — Hosted backend + customer storage (BYOS skills) — future

|                  |                                                 |
| ---------------- | ----------------------------------------------- |
| Backend          | Still Nuphos-hosted                             |
| Team skill bytes | Customer bucket (or customer-controlled prefix) |
| Global / builtin | Likely remain Nuphos-owned                      |
| Who chooses it   | **Per-team opt-in**, never the platform default |

**Not implemented.** Resolution is already centralized:

```ts
// lib/agent/skill-store/skills-s3.ts
getSkillsStore(_opts?: { teamId?: string | null; scope?: string }): SkillsS3Client
// today → SkillsS3Client.fromConfig() (Mode 1 / Mode 2 process env)
```

| Concern              | Mode 1 (default)                | Mode 3 (future)                                               |
| -------------------- | ------------------------------- | ------------------------------------------------------------- |
| Resolve client       | Process env                     | Team binding (role ARN / keys) + fallback env                 |
| Object prefix        | `teams/<id>/skills/…`           | May use bucket-root `skills/…` (API scope still `teams/<id>`) |
| AuthZ                | Team membership (unchanged)     | Same + “can this team use BYOS?”                              |
| Merge cache          | `.merged/team-<id>` (unchanged) | Unchanged                                                     |
| Routes / agent tools | Scope only                      | Unchanged if resolution stays inside `getSkillsStore`         |

Reuse existing **AWS BYOS connector** patterns (assume-role / OIDC) for
credentials rather than inventing a third identity model.

**Explicit non-work until demand:** UI to bind a skills bucket, live connection
tests, multi-cloud S3-compatible matrix, migration from hosted prefix → BYOS.

---

## What is already extension-friendly

These boundaries should stay stable:

1. **Scope string** as the only product identity for a skills namespace.
2. **Scope-relative keys** (`skills/…`) at the API boundary.
3. **Merge order** and reserved builtin names.
4. **Per-team merge output dir** (`.merged/team-<id>`).
5. Team routes that **derive** scope from auth context (never trust client scope
   for team mutations).
6. **`getSkillsStore({ teamId?, scope? })`** as the only place that picks a
   backend (Mode 1/2 today; Mode 3 later).

What remains for Mode 3:

1. Team document fields for skills storage binding.
2. Logic inside `getSkillsStore` to return a BYOS client when bound.
3. Optional bucket-root key layout for BYOS (API scope unchanged).

---

## Key source map

| Area                          | Path                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Config                        | `src/config.ts` → `skillsStore`                                               |
| Scope / keys                  | `src/lib/agent/skill-store/scope.ts`                                          |
| S3 client + resolver          | `src/lib/agent/skill-store/skills-s3.ts` (`getSkillsStore`)                   |
| Seed script                   | `scripts/upload-skills.ts` (`bun run skills:upload`)                          |
| Legacy backfill               | `scripts/backfill-skill-metadata.ts` (`bun run skills:backfill-metadata`)     |
| Pending-intent reconciliation | `scripts/reconcile-skill-mutations.ts` (`bun run skills:reconcile-mutations`) |
| Provenance projection/events  | `src/lib/agent/skill-store/metadata.ts`                                       |
| CRUD / manifest               | `src/lib/agent/skill-store/service.ts`                                        |
| Sync + cache                  | `src/lib/agent/skill-store/sync.ts`                                           |
| Merge + resolve               | `src/lib/agent/skill-store/merge.ts`                                          |
| Sandbox inject                | `src/lib/agent/skill-store/inject.ts`                                         |
| Team HTTP                     | `src/routes/team-skills.ts`                                                   |
| Admin HTTP                    | `src/routes/admin-skills.ts`                                                  |
| Agent tools                   | `src/lib/agent/tools-team-skills.ts`                                          |
| Desktop UI                    | `apps/desktop/src/views/TeamSkillsView.tsx`                                   |
| Parallel BYOS seam            | `src/lib/storage/index.ts` (file transfer)                                    |

---

## Operator checklist (hosted enablement)

1. Create/choose S3 bucket; IAM user/role with list/get/put/delete on the prefix
   tree above.
2. Set `ATLAS_SKILLS_BUCKET`, `ATLAS_SKILLS_S3_ACCESS_KEY_ID`,
   `ATLAS_SKILLS_S3_SECRET_ACCESS_KEY` (and region if not `us-east-1`) on
   **backend** only.
3. Roll out `nuphos-backend` so pods pick up env.
4. Smoke: `GET /teams/:teamId/skills/manifest` as a member → 200 JSON, not
   `skills_store_unconfigured`.
5. Optional: seed `global/skills/…` for deployment-wide overlays.
   `skills:upload` now records import provenance and therefore also requires
   `MONGODB_URI`; pass `--actor-user-id <id>` when the invoking user is known.
6. On an existing bucket, preview then register legacy records:
   `bun run skills:backfill-metadata -- --dry-run`, then rerun without
   `--dry-run`. This is insert-only and never overwrites tracked provenance.
7. If a process died between S3 and Mongo result persistence, preview stale
   intents with `bun run skills:reconcile-mutations -- --dry-run` before
   applying reconciliation.

---

## Summary

| Mode                           | Backend  | Storage               | Status                                          |
| ------------------------------ | -------- | --------------------- | ----------------------------------------------- |
| **1 Hosted + Nuphos bucket**   | Ours     | Ours, prefix per team | **Default product path**                        |
| **2 Self-host**                | Customer | Customer env bucket   | **Supported by config**                         |
| **3 Hosted + customer bucket** | Ours     | Customer BYOS         | **Future opt-in**; extend `getSkillsStore` only |
