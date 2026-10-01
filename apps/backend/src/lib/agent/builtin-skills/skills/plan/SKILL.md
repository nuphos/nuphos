---
name: plan
description: Load this BEFORE any plan work. The complete manual for execution-plan approval cards; building, revising, executing, retrying, and reconciling them through the plan REST API.
---

# plan

Plans are persisted approval cards for non-trivial Cloud Infra work. You create the shell with the `plan_create` tool, then build and maintain everything else through the plan REST API (documented here, with a helper script). The frontend renders the card live from the API — never restate the plan as a markdown table in prose.

The prefix system message defines WHEN a plan is warranted. This skill is the manual for HOW.

## The API surface

One tool + three REST calls, all team/user-scoped by the caller's token:

| Operation | How |
|---|---|
| Create (title + overview only) | `plan_create` tool — returns `planId` |
| Read one / list | `bash skills/plan/scripts/plan.sh get <planId> [teamId]` / `plan.sh list [teamId]` |
| Everything else | `bash skills/plan/scripts/plan.sh patch <planId> '<json>' [teamId]` |

Pass the current team id (from the "Nuphos resource links" system message) as the trailing argument whenever this conversation has a team — without it the API resolves personal scope and will not find team plans.

`patch` accepts these body fields (combine freely; at least one required):

- Proposal construction / revision (only while status is `proposed`):
  - `{"decisions": [{"label": "Region", "value": "us-east-1"}, ...]}` — replaces the section
  - `{"appendStep": {"title": "...", "description": "...", "jobs": [{"title": "...", "commands": [{"command": "...", "description": "..."}]}]}}` — one step per call, in order; add `"insertAt": N` to insert instead of append
  - `{"editStep": {"stepIdx": 0, "step": {...}}}` — full replacement for one step (0-based, `plan.sh get` order), not a diff
  - `{"removeStep": {"stepIdx": 2}}` — later steps shift up
  - `{"title": "...", "overview": "..."}` — either or both
  - `{"costSummary": "...", "costOneTime": "...", "costMonthly": "...", "costSavings": "..."}`
  - `{"riskWorstCase": "...", "riskMitigations": ["...", "..."]}`
- Execution progress (after approval):
  - `{"status": "executing"|"completed"|"failed"|"cancelled"}`
  - `{"commandStatuses": [{"stepIdx": 0, "jobIdx": 0, "cmdIdx": 0, "status": "running"|"done"|"failed"}, ...]}` — batch as many as you like

A 4xx response explains what was wrong — fix the JSON and retry. Revision calls on a non-`proposed` plan are rejected: once the user approved, the card content they confirmed is locked; propose a NEW plan for materially changed work.

## Proposal — exact build sequence

1. `plan_create` with title + overview ONLY (never inline decisions/steps/cost/risk).
2. `patch` decisions — an empty array is fine when there are genuinely no choices to record.
3. `patch` one `appendStep` per execution step, in order. Step `title` is required on the step object.
4. `patch` cost: `costSummary` required (one honest headline number, e.g. "~$18/month for 1× t3.small RDS"; lead with savings for cleanups); fill only the optional details that apply — never write "n/a".
5. `patch` risk: `riskWorstCase` required (a realistic worst outcome — "could fail" does not count, "Lose the last 24h of MySQL writes if the EFS snapshot is corrupt" does) and ≥1 concrete `riskMitigations` ("Snapshot the EBS volume before delete", not "be careful").
6. STOP the turn: one short sentence of prose calling out the single most important thing (the cost, the risk, an assumption, or what happens on approval) — NOT a plan restatement and NOT "please confirm". Then end the turn. Do NOT execute planned commands, do NOT assume approval, do NOT call bash/local_exec for the planned work. The user clicks Approve (on the Slack card or in Nuphos), which sends a follow-up message; treat that as new instructions. A chat reply saying "approve"/"ok" does NOT change the plan's status — never respond to one by patching `executing` (the API rejects it on an unapproved plan); instead confirm the plan is still `proposed` with `plan.sh get` and point them, in one friendly sentence, to the Approve button on the card in this thread or to the plan link in Nuphos.

Keep every payload compact. No heredocs, manifests, diffs, logs, or base64 inside plan fields; commands in the card are short executable summaries and bulky content gets created during execution. Group many low-level operations into a few reviewable steps.

## Decisions, not questions

- The card IS the confirmation. Never write "Confirm: …?", "Choose A or B?" anywhere in it.
- For every choice you would otherwise ask about (account, region, size, retention, naming...), pick the most defensible option yourself and record it as a `decisions` entry ({"label": "Region", "value": "us-east-1"}). The user redirects via chat if they disagree.
- When a materially cheaper or free alternative exists to a default you chose (zonal vs regional control plane, spot vs on-demand, single-AZ vs multi-AZ...), record the choice AND the cost delta in its `decisions` entry — the user must see the money they are declining to save before approving.
- Decisions are not steps: never create a step/job whose only purpose is to state a choice. Steps are the things you will actually run.
- Research before asking: unknown project/image/repo names get a web_search / RAG / context lookup first; then decide and note the assumption in the trailing prose. Ask only for genuinely private or safety-critical unknowns, in one concise question.

## Permissions preflight (before plan_create)

- Inventory required vs. currently-held permissions across every system the work touches. Nuphos-API-only work (binding roles, editing access lists, integration metadata) needs no cloud credentials — `NUPHOS_TOKEN` is the current user's token, not a read-only agent identity.
- Missing cloud permission (AWS/GCP/Azure): check whether another connected identity the user can already use has the access. Otherwise name the exact missing permission and affected identity/resource, and explain the narrowest change the user should make in the cloud console. Offer `local_exec` on a user-selected device already signed in to the matching CLI with permission to administer the connector; verify its cloud account and identity before the scoped change. Otherwise the user can make the change in the cloud console. Retry after it succeeds.
- If you can narrowly self-grant other kinds of missing scope, make that an explicit early plan step with a verification step after it.
- Surface any missing external credential/capability in decisions, risk, or the trailing prose so the user can fix it before approving.

## Each plan is self-contained

A step/job/command may never reference another plan ("continue plan #2", "see plan X"). Fold related work into one complete plan, or make this one stand alone and create the next one separately.

## Revising a still-`proposed` plan

The user asked to tweak something → revise the SAME plan in place with `editStep` / `appendStep`+`insertAt` / `removeStep` / `title`/`overview` / section patches. Touch only what changed, finish with one sentence stating what changed, stop, and let them approve. Do NOT cancel-and-recreate, and do NOT ask about marking it unplanned just to apply an edit. Create a brand-new plan only when the user redirects to fundamentally different work — then ask about cancelling the old one.

## After approval — keep the card live

The agent is the source of truth; the UI displays what you report.

- Flip `{"status": "executing"}` once, before the first command.
- Right before each planned command: `patch` its commandStatus to `running`; right after: `done` or `failed`. Batch multiple changes in one call.
- Exactly one command may be `running` at a time. Before marking the next one `running`, the previous one must already be `done` or `failed` — a stale `running` makes the card claim two steps are executing at once.
- The `planId` from `plan_create` is the id for every later call; never call `plan_create` again to add progress or revisions.
- If you deviate from the plan (different command, skipped step), still mark the affected commands `done`/`failed` so nothing shows pending forever.
- Before setting `{"status": "completed"}`, every command in every step must already be `done` or `failed` — `completed` means genuinely finished. If the run stopped partway, leave it `executing` or set `failed`.

## Retrying a failed plan

"Retry/rerun/resume" a `failed` plan = the SAME plan, not a new one. `plan.sh get` first; `patch` status back to `executing` and reset the commands you will re-run (`pending`, or `running` for the first); keep per-command updates flowing exactly like the first run; on success mark everything `done` then `completed`, on another failure mark the command `failed` and the plan `failed`.

## Before ending any turn — reconcile

Never leave a non-terminal plan (`proposed`/`approved`/`executing`) whose stored status disagrees with reality. `plan.sh get` it, then:
- Reality moved ahead → `patch` the finished commands and lifecycle into sync.
- Abandoned/superseded → ask in ONE short sentence whether to mark it unplanned; set `{"status": "cancelled"}` only after they confirm.
- Genuinely in progress and accurate → leave it.
