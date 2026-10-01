---
name: nuphos-plan
description: Create, revise, inspect, and execute Nuphos approval plans with the bundled semantic scripts. Use this for every Nuphos plan workflow in Claude Code.
---

# Nuphos Plan

Use the scripts in this skill. They call the conversation-scoped Nuphos API for you; do not
construct Plan API URLs, use `curl` directly, inspect environment variables, or look for another
plan helper.

Run the commands below from the workspace root. The scripts are installed with this skill at
`.claude/skills/nuphos-plan/scripts`.

## Commands

```bash
bash .claude/skills/nuphos-plan/scripts/propose.sh '<complete proposal JSON>'
bash .claude/skills/nuphos-plan/scripts/create.sh '<title>' '<overview>'
bash .claude/skills/nuphos-plan/scripts/get.sh '<planId>'
bash .claude/skills/nuphos-plan/scripts/list.sh
bash .claude/skills/nuphos-plan/scripts/set-decisions.sh '<planId>' '<JSON array>'
bash .claude/skills/nuphos-plan/scripts/add-step.sh '<planId>' '<step JSON>' [insertAt]
bash .claude/skills/nuphos-plan/scripts/edit-step.sh '<planId>' '<stepIdx>' '<step JSON>'
bash .claude/skills/nuphos-plan/scripts/remove-step.sh '<planId>' '<stepIdx>'
bash .claude/skills/nuphos-plan/scripts/set-meta.sh '<planId>' '<title>' '<overview>'
bash .claude/skills/nuphos-plan/scripts/set-cost.sh '<planId>' '<summary>' [oneTime] [monthly] [savings]
bash .claude/skills/nuphos-plan/scripts/set-risk.sh '<planId>' '<worst case>' '<mitigations JSON array>'
bash .claude/skills/nuphos-plan/scripts/set-command-statuses.sh '<planId>' '<changes JSON array>'
bash .claude/skills/nuphos-plan/scripts/set-command-statuses.sh '<planId>' '<stepIdx>' '<jobIdx>' '<cmdIdx>' running|done|failed|pending
bash .claude/skills/nuphos-plan/scripts/set-status.sh '<planId>' executing|completed|failed|cancelled
```

Every script prints the persisted Plan JSON on success and a useful API error on failure. The
runtime supplies its short-lived API context automatically; never print or inspect it. When you
mention or link the Plan, use the returned `_links.app` value verbatim. Never construct, guess,
or rewrite a Nuphos URL.

For a new Plan, prefer `propose.sh`: it validates the complete card locally before creating
anything, then persists every section in one shell tool call. Its JSON shape is:

```json
{
  "title": "Change title",
  "overview": "What and why",
  "decisions": [{ "label": "Scope", "value": "Production only" }],
  "steps": [
    {
      "title": "Apply the change",
      "jobs": [
        {
          "title": "Service group",
          "commands": [{ "command": "semantic operation", "description": "Expected effect" }]
        }
      ]
    }
  ],
  "costSummary": "Expected cost impact",
  "riskWorstCase": "Realistic worst outcome",
  "riskMitigations": ["Concrete mitigation"]
}
```

Optional top-level cost fields are `costOneTime`, `costMonthly`, and `costSavings`. Decision
objects are always `{ "label": "...", "value": "..." }`; never invent alternate keys or consult
OpenAPI for these scripts.

## Proposal sequence

1. Gather the facts needed to make the proposal concrete.
2. Run `propose.sh` once with the complete card JSON.
3. Verify the returned persisted card, then stop the turn with one concise sentence containing
   the Plan link from `_links.app` and the most important cost, risk, assumption, or what approval
   will trigger.

Do not execute the proposed work before the user clicks Approve. A chat reply such as "ok" does
not approve a Plan.

## Decisions and content

- The card is the confirmation. Choose defensible defaults and record them as decisions instead
  of putting questions into the card.
- Steps describe work that will actually run; decisions are not fake execution steps.
- Keep payloads compact. Do not place logs, manifests, diffs, heredocs, or base64 in the card.
- Missing cloud permission is handled with Nuphos permission-grant capabilities before creating
  the Plan, not as a Plan step.

## Revision

While a Plan is still `proposed`, revise the same Plan with `set-meta.sh`, `set-decisions.sh`,
`add-step.sh`, `edit-step.sh`, `remove-step.sh`, `set-cost.sh`, and `set-risk.sh`. Do not recreate
it merely to change content. Once approved, proposal content is immutable.

## Execution

After an approval follow-up:

1. Confirm the Plan with `get.sh`, then set it to `executing`.
2. Immediately before a planned command, mark that command `running`; immediately afterward mark
   it `done` or `failed` with `set-command-statuses.sh`.
3. Keep at most one command `running`.
4. Mark the Plan `completed` only after every command is `done` or `failed`. If work stops early,
   leave it executing or mark it failed.

Retry a failed Plan in place: inspect it, set it back to `executing`, reset the commands being
retried, and continue reporting progress. Never create a replacement solely for a retry.

Use the positional form for a single command. For a batch, the exact JSON shape is:

```json
[{"stepIdx":0,"jobIdx":0,"cmdIdx":0,"status":"running"}]
```

`stepIdx`, `jobIdx`, and `cmdIdx` are zero-based. Do not use `stepIndex`, `jobIndex`,
`commandIndex`, or `commandIdx`.

Every Plan mutation must be its own shell tool call. Do not chain it with another Plan script or
with the planned workload; do not pipe its output or redirect stdout/stderr. Read the returned
persisted Plan and verify the requested state before continuing. If a call partially succeeded or
the current state is uncertain, run `get.sh` and reconcile from the persisted state instead of
blindly repeating the mutation.
