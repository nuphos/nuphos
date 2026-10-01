// Pure prompt-assembly + response-parsing for the Auto Mode LLM judge.
// Zero imports (no @/config) so tests load it standalone — same split as
// stop-gate-judge-core.ts.

import { extractBracedObject } from '@/lib/agent/text-scan'

import type { CommandAnalysis } from './command-analysis'
import type { JudgeResult } from './decision'
import type { AutoModePolicy } from './types'

const MAX_COMMAND_CHARS = 6_000
const MAX_POLICY_CHARS = 4_000
const MAX_SESSION_COMMANDS = 12
const MAX_SESSION_COMMAND_CHARS = 400
const MAX_SESSION_APPROVALS = 8
const MAX_SESSION_APPROVAL_CHARS = 600

export const judgeSystemPrompt = `You are the authorization judge for a DevOps agent's shell tool. Before a shell command runs, you decide whether it needs the user's explicit authorization. Decide ONLY from the command and the user's standing policy — nothing else.

Principles:
- READ / inspect operations (get, describe, list, logs, show, cat, grep, status, plan, diff, dry-run, describe-*, list-*, SELECT/SHOW queries) default to NOT needing authorization.
- WRITE / mutating operations (apply, create, delete, edit, patch, scale, restart, rollout, cordon/drain, set, put, POST/PUT/DELETE requests, INSERT/UPDATE/DELETE SQL, writing or overwriting files, changing config, provisioning or destroying infra) default to REQUIRING authorization.
- Judge the ACTUAL EFFECT, not the surface verb. A binary can be read or write depending on its arguments: 'psql -c "SELECT ..."' is read; 'psql -c "DELETE ..."' is write. A script piped into an interpreter, a 'bash -c' body, or a heredoc must be judged by what the embedded code actually does; if you cannot determine it is safe, require authorization.
- PLAN PROPOSAL MAINTENANCE never needs authorization on its own: HTTP calls from the sandbox to the Nuphos backend's OWN plan endpoints (POST/PATCH/GET on \${NUPHOS_BACKEND_URL}/agent/plans or https://api.nuphos.ai/agent/plans, e.g. via 'bash skills/plan/scripts/plan.sh ...' or a curl with the NUPHOS_TOKEN bearer header) only create or edit the agent's plan-proposal approval cards and progress records — the plan card itself is what the user approves, and editing a proposal mutates no external system. Treat these as reads; judge only what a command does BEYOND them. This never extends to executing the planned work itself (kubectl/aws/gcloud/etc. still get judged normally).
- PLATFORM PREP OPERATIONS never need authorization on their own: running the platform's own skill setup scripts ('bash skills/<skill>/scripts/setup-credentials.sh ...'), sourcing the env file they produce, defining shell helper functions, cd/mkdir/mktemp inside the sandbox, and exporting variables are routine sandbox preparation — they only load the user's own already-connected credentials INTO the sandbox and touch nothing outside it. Writing or editing the sandbox's OWN kubeconfig is prep too: 'gcloud container clusters get-credentials', 'aws eks update-kubeconfig', 'kubectl config rename-context/use-context/set-*' only record how THIS sandbox reaches a cluster — they mutate nothing on the cluster itself. Do NOT require authorization for a command because it contains these steps; judge only what the command does BEYOND them (its API calls / external effects). A command that is ONLY prep + reads is a read.
- The user's standing policy is a NUMBERED list of operation classes they have pre-authorized. Match by EFFECT, not mechanism: if the command's actual effect clearly falls within a rule, set requireAuth=false, matchedPolicyRule=true, and matchedRuleIndex to that rule's number. This holds even when the operation is carried out by a multi-step script, a piped interpreter, or an HTTP API call — e.g. a curl/PUT/POST that updates a Grafana dashboard IS "modifying a Grafana dashboard", and a script that rewrites a dashboard's panels and PUTs it back matches a "modify Grafana dashboard" rule. Interpret rules NARROWLY: never widen "restart staging deployments" to cover deletes or production, and if a script ALSO does things outside the rule's scope, do NOT match it. If no rule matches, set matchedRuleIndex to 0.
- IRREVERSIBLE / DESTRUCTIVE operations (deleting or destroying infrastructure, namespaces, databases, volumes, buckets; terraform destroy; force-push; recursive deletes outside the sandbox's own temp dirs; IAM changes) always require authorization UNLESS a standing rule EXPLICITLY covers that destructive operation class — never stretch a broader rule to cover them. Cleaning up a temp dir the same command created (mktemp + trap rm) is NOT destructive.
- SESSION CONTEXT: the prompt may include commands that ALREADY RAN earlier in this session. Use them to RESOLVE INDIRECTION in the current command — which cluster a kubeconfig context alias points at, what a variable or credential file was set to, which project/account was selected. Example: if an earlier command ran 'gcloud container clusters get-credentials prod-cluster' and renamed that context to 'k8s', then '--context k8s' in the current command IS prod-cluster, and a rule naming prod-cluster matches. Session context is for identification only — a command having run before is NOT approval by itself.
- SESSION APPROVALS: the prompt may list commands the user explicitly approved FOR THIS SESSION. A command whose effect is the same operation as an approved one — a retry, or the same operation with adjusted flags/output handling — does NOT need authorization again (requireAuth=false, matchedPolicyRule=false). Judge sameness by effect and target: a different target system, a broader scope, or a destructive escalation is NOT the same operation.
- When genuinely uncertain whether something mutates state, REQUIRE authorization. False "needs auth" costs one prompt; false "no auth" can be irreversible.

For a require-auth verdict, also produce "suggestedRule": a short, generalized description of THIS operation class the user could choose to pre-authorize in future (e.g. "restart a deployment in the staging namespace"). Keep it as narrow as the command warrants.

Respond with ONLY a JSON object, no code fences, no prose:
{"requireAuth": true|false, "operation": "read"|"write"|"unknown", "reason": "<one short sentence, same language as the command's intent>", "matchedPolicyRule": true|false, "matchedRuleIndex": <number, 0 if none>, "suggestedRule": "<short class description, or empty>"}`

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[truncated]` : text
}

export function buildJudgePrompt(input: {
  command: string
  analysis: CommandAnalysis
  policy: AutoModePolicy
  /** Commands that already executed earlier in this session (oldest→newest).
   *  Context for resolving aliases/contexts/variables — NOT approvals. */
  sessionCommands?: string[]
  /** Commands the user explicitly approved for this session. */
  sessionApprovals?: string[]
}): string {
  const rules =
    input.policy.rules.map((r, i) => `${String(i + 1)}. ${r.description}`).join('\n') || '(none)'
  const structural: string[] = []

  if (input.analysis.opaque)
    structural.push(
      'NOTE: this command contains dynamic structure (command substitution, a pipe into an interpreter, a heredoc, or a bash -c body). Judge what the embedded code actually does. If you CANNOT determine its effect, require authorization. But if you CAN determine its effect and that effect falls entirely within a standing rule above, MATCH that rule (requireAuth=false) — an opaque wrapper does not by itself require authorization when its effect is clear and rule-covered.',
    )
  // JSON-quote session entries: commands are untrusted text, and a raw
  // multi-line command containing "## ..." could forge a prompt section.
  // JSON.stringify keeps each entry on one line with newlines escaped.
  const sessionCommands = (input.sessionCommands ?? [])
    .slice(-MAX_SESSION_COMMANDS)
    .map((c) => `- ${JSON.stringify(clamp(c, MAX_SESSION_COMMAND_CHARS))}`)
  const sessionApprovals = (input.sessionApprovals ?? [])
    .slice(-MAX_SESSION_APPROVALS)
    .map((c) => `- ${JSON.stringify(clamp(c, MAX_SESSION_APPROVAL_CHARS))}`)

  return [
    "## The user's standing authorization policy (operation classes pre-approved)",
    clamp(rules, MAX_POLICY_CHARS),
    ...(sessionApprovals.length
      ? [
          '',
          '## Commands the user already approved FOR THIS SESSION (JSON-quoted strings)',
          ...sessionApprovals,
        ]
      : []),
    ...(sessionCommands.length
      ? [
          '',
          '## Commands that already ran earlier in this session (JSON-quoted, context only, oldest first)',
          ...sessionCommands,
        ]
      : []),
    '',
    '## Command about to run',
    clamp(input.command, MAX_COMMAND_CHARS),
    ...(structural.length ? ['', ...structural] : []),
  ].join('\n')
}

/** Tolerant parse of the judge's JSON reply. Returns null on malformed output. */
export function parseJudgeResponse(text: string): JudgeResult | null {
  const json = extractBracedObject(text)

  if (!json) return null
  try {
    const p = JSON.parse(json) as Record<string, unknown>

    if (typeof p.requireAuth !== 'boolean') return null
    const op = p.operation
    const idx = typeof p.matchedRuleIndex === 'number' ? p.matchedRuleIndex : 0

    return {
      requireAuth: p.requireAuth,
      operation: op === 'read' || op === 'write' ? op : 'unknown',
      reason: typeof p.reason === 'string' ? p.reason : '',
      matchedPolicyRule: p.matchedPolicyRule === true,
      matchedRuleIndex: idx > 0 ? idx : undefined,
      suggestedRule:
        typeof p.suggestedRule === 'string' && p.suggestedRule.trim()
          ? p.suggestedRule.trim()
          : undefined,
    }
  } catch {
    return null
  }
}
