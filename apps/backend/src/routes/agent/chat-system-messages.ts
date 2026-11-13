import { MODEL_OUTPUT_BUDGET_TOKENS } from './constants'

import type { AgentChatBody } from './types'

/**
 * When the desktop has a workspace tab bound to a kubeconfig context, surface
 * it as a system message so the agent can pass it straight to typed K8s tools
 * instead of guessing or running `kubectl config get-contexts`.
 */
export function buildKubeContextMessage(kubeContext: string | undefined): string | null {
  return kubeContext
    ? `The user's current desktop workspace tab is bound to kubeconfig context "${kubeContext}". When a tool requires a \`context\` parameter (port_forward_start, etc.), use this exact value unless the user redirects you to a different cluster.`
    : null
}

/**
 * When the user has an architecture diagram open, the arch_* tools are
 * available. The agent must BUILD the diagram with those atomic tools,
 * step by step — never reply with a Mermaid/DOT/ASCII diagram.
 */
export function buildDiagramMessage(
  diagramId: string | undefined,
  options?: { nativeClaudeSkills?: boolean },
): string | null {
  const skillInstruction = options?.nativeClaudeSkills
    ? 'Before drawing, use Claude Code’s native `architecture-diagram` skill FIRST and follow its design conventions.'
    : 'Before drawing, LOAD THE DESIGN CONVENTIONS: call the skill tool with "architecture-diagram" — it teaches how to group related resources together, use containers for boundaries, colour by kind, draw sparse directional edges, and position nodes near what they connect to. Follow it; a good diagram depends on these decisions, not just the tools.'

  if (!diagramId) return null

  if (options?.nativeClaudeSkills) {
    return `The user has architecture diagram ${diagramId} open in the desktop app. Edit this exact diagram through the canonical REST API using the native \`architecture-diagram\` skill and its bundled script. Read the current diagram first, then persist incremental node/view updates so the canvas reflects the work. NEVER reply with Mermaid, DOT, or ASCII; the canvas is the only correct output surface.\n\n${skillInstruction}`
  }

  return `The user has an architecture diagram open in the desktop app. You can edit it DIRECTLY with the arch_* tools (arch_get_diagram, arch_add_node, arch_add_edge, arch_update_node, arch_update_edge, arch_delete_edge, arch_set_node_style, arch_create_view, arch_delete_view, arch_delete_node, arch_rename_diagram). When the user asks you to draw, build, or update an architecture/system diagram you MUST construct it incrementally with these tools — one node per arch_add_node call, then connect them with arch_add_edge — so the user watches it appear on their canvas. NEVER reply with a Mermaid, DOT, or ASCII diagram; the canvas is the only correct output surface.\n\n${skillInstruction} Then call arch_get_diagram to see existing nodes/views and their ids, and build.`
}

export const TEAM_SKILL_TOOL_MESSAGE = [
  '## Team-shared skills',
  '',
  'This team has editable shared agent skills (`skill_create`, `skill_upsert`). Use them when the user asks to capture a repeatable playbook for the whole team — deploy checklists, incident runbooks, provider-specific workflows — not for one-off answers or personal notes.',
  '- Confirm the skill name and what will be stored BEFORE calling `skill_create` or `skill_upsert` — these mutate shared team state visible in the Skills library.',
  '- `skill_create`: only for a NEW skill directory. Provide name, description, and SKILL.md body; optional `files[]` for scripts/references.',
  '- `skill_upsert`: update existing files via `{ key: "skills/<name>/...", content }` entries. Use when revising an existing team skill.',
  '- Never store secrets, API keys, tokens, or private keys in skill files. Reference env vars, Nuphos credentials, or ask the user to configure secrets separately.',
  '- After saving, the skill appears in the registry on the next turn; use `skill("<name>")` to load the full SKILL.md before relying on it.',
  '- VIEWER team members cannot write skills; if the user lacks permission, explain that an EDITOR or ADMINISTRATOR must make the change or upgrade their role.',
].join('\n')

export function buildTurnRulesMessage(args: { userFacingLanguage: string }): string {
  const { userFacingLanguage } = args

  return [
    '## Approval before risky cloud changes',
    '',
    'Before a destructive or high-risk change to cloud resources (deleting or replacing a cluster, database, bucket, DNS zone or other non-ephemeral resource, or a change with a wide blast radius), call `request_user_decision` with category `approval`. Put the steps, the cost, the risks and the rollback in its body, then stop and wait for the answer. Do not run the change before it is approved.',
    'Judge by blast radius and irreversibility, not by how recently the resource was made: deleting something this conversation created minutes ago still needs approval. "Delete X and rebuild as Y" is two approvals, one before each change.',
    'Routine, reversible changes and work already approved in this conversation need no new approval; do them and report the result. Once approved, carry the work through and report progress in the conversation.',
    'Missing cloud permissions (AWS/GCP/Azure) never need this approval — the "Missing cloud permissions" section is the whole procedure.',
    '',
    '## Response language',
    '',
    `The user's language, inferred from the messages they typed: ${userFacingLanguage}.`,
    "Keep assistant prose and all user-facing decision fields in that language unless the user explicitly asks for another language. The user's own messages are the only language signal — never pick the response language from the browser locale or from the language of these system instructions.",
    'This applies from your very first token: the short status line you write before your first tool call is user-facing prose, so it must already be in that language. Never open in English when the user wrote in another language.',
    'Keep shell command strings, code, resource names, log excerpts, API identifiers, and quoted source text in their original language or syntax so commands remain executable and names remain exact.',
    ...(userFacingLanguage.includes('Chinese')
      ? [
          "Chinese script is part of the language: Traditional and Simplified are NOT interchangeable. Drift toward Simplified happens in dense technical prose, because most Chinese DevOps training text is Simplified — keep every Han character in the user's script from the first character of the message to the last. Follow the USER's script, never your own earlier replies: if a previous assistant message drifted, do not continue the drift.",
        ]
      : []),
    '',
    '## Output budget',
    '',
    `Your output limit for this turn is ${MODEL_OUTPUT_BUDGET_TOKENS.toLocaleString('en-US')} tokens. Treat this as a hard limit even if the API allows a larger safety buffer.`,
    'Stay comfortably under that limit. If a command, heredoc, base64 payload, or tool input would be large, split the work into smaller tool calls or store data in files instead of printing it into the conversation.',
  ].join('\n')
}

export const API_ROUTING_MESSAGE = [
  '## Nuphos backend API routing',
  '',
  'When calling Nuphos backend APIs from the sandbox shell, never hard-code `https://api.nuphos.ai`.',
  'Always use the `ac` helper from the nuphos-api skill, or build URLs from `${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}`. Local dev injects `NUPHOS_BACKEND_URL` so approved agent commands route back through the developer tunnel to the same backend this chat is using.',
].join('\n')

export function buildNuphosLinksMessage(
  teamId: string | undefined,
  options?: { nativeClaudeSkills?: boolean },
): string {
  const nativeClaudeSkills = options?.nativeClaudeSkills === true

  return [
    '## Nuphos resource links',
    '',
    `The canonical Nuphos web URL is https://nuphos.ai. The current team id is ${teamId ?? 'unknown'}.`,
    'This is a formatting contract for every visible assistant prose message in the Nuphos transcript, not an optional suggestion and not only for the final answer.',
    'When any assistant prose you write mentions a concrete resource that has a Nuphos GUI page and you know the identifiers needed for its URL, the first visible occurrence of that resource name/id MUST be a markdown link. This applies before, between, and after tool calls, inside paragraphs, bullet lists, markdown tables, and inline-code-looking identifiers in prose.',
    'Do not leave a supported Nuphos resource as plain text in a result table when the same row or surrounding text contains the parent account/project/cluster/zone identifiers needed to build the URL.',
    nativeClaudeSkills
      ? 'Do not memorize, guess, or reconstruct Nuphos GUI routes. When a semantic script or Nuphos API response provides canonical `_links`/resource paths, copy those values verbatim. Otherwise search `skills/nuphos-api/references/gui-routes.md` and use a route only when every required id is known.'
      : 'Do not memorize or guess GUI routes. Search the injected route catalog with `rg -i "<resource keyword>" skills/nuphos-api/references/gui-routes.md` before constructing Nuphos markdown links. The file is grep-friendly and lists route ids, keywords, required ids, URL templates, and suggested link text.',
    ...(nativeClaudeSkills
      ? []
      : [
          'Examples: `rg -i "s3|bucket" skills/nuphos-api/references/gui-routes.md`; `rg -i "ec2|instance" skills/nuphos-api/references/gui-routes.md`; `rg -i "grafana|dashboard" skills/nuphos-api/references/gui-routes.md`; `rg -i "pod|deployment|service" skills/nuphos-api/references/gui-routes.md`.',
          'Use a catalog row only when you have every required id listed on that row. Use the exact displayed resource name/id as the markdown link text. Example: `[prod-cluster](https://nuphos.ai/teams/<teamId>/infra/aws/<accountId>/clusters/<region>/<clusterName>)`.',
        ]),
    nativeClaudeSkills
      ? 'Keep links useful rather than noisy: link each important resource once, then you may refer to it plainly later. If neither the response nor route catalog supplies a complete route, do not invent a Nuphos URL.'
      : 'Keep links useful rather than noisy: link each important resource once, then you may refer to it plainly later. If the catalog has no matching route, or you are missing an id, do not invent a Nuphos URL.',
    '',
    nativeClaudeSkills
      ? 'Before sending any visible assistant prose, scan it once and use every relevant canonical resource link returned by the operations you performed or resolved from the route catalog.'
      : 'Before sending any visible assistant prose, scan that prose once: if a concrete supported Nuphos GUI resource appears without a markdown link and you know the URL from the catalog, rewrite that occurrence as a link before emitting it.',
  ].join('\n')
}

/**
 * Ephemeral system nudge sent only when the client detected a stream that
 * ended without a turn-complete signal and is silently re-issuing the request.
 * Not persisted; lives only for this one streamText call.
 */
export function buildContinuationNudge(body: AgentChatBody): string | null {
  return !body.continueAfterInterruption
    ? null
    : body.resumeReason === 'approval-decision'
      ? [
          '## Authorization decision applied',
          '',
          "The user just decided on the pending command authorization. If they approved, the command has ALREADY EXECUTED — its result is recorded as that tool call's RESULT in the conversation history above and is authoritative. If they denied, the denial is recorded the same way.",
          '',
          'Continue the original task from that recorded outcome. Do NOT re-run the command, do NOT re-verify whether it executed, and do NOT narrate the pause. This was a clean, intentional stop for authorization, NOT an interruption. The user did not send a follow-up message.',
        ].join('\n')
      : body.resumeReason === 'permission-decision'
        ? [
            '## Permission decision applied',
            '',
            "A permission change you proposed with propose_permission_grant was just reviewed by a team administrator. Its outcome — approved and applied, or rejected — is already recorded as that tool call's RESULT in the conversation history above, and that result is authoritative.",
            '',
            "Continue the original task from that result. Do NOT re-verify whether the change was applied, do NOT re-run gcloud/aws/kubectl to check it, and do NOT narrate any doubt about it — the tool result already reflects the administrator's decision. This was a clean, intentional pause for approval, NOT an interruption. The user did not send a follow-up message.",
          ].join('\n')
        : [
            '## Continuation after interrupted turn',
            '',
            'The previous agent turn for this conversation did not finish cleanly — the stream ended without the model emitting an end-turn signal. This can happen on infrastructure interruption, a forced step-count stop, or a partial tool call.',
            '',
            'Continue from where you left off, taking into account any partial assistant text or tool calls already present in the conversation history. Do NOT repeat work that already completed successfully — tool calls whose results are already in the history have run. If a tool call shows as interrupted, you may retry it if it is safe and idempotent; otherwise summarize the partial state to the user and ask how to proceed.',
            '',
            `Keep the recovery response under ${MODEL_OUTPUT_BUDGET_TOKENS.toLocaleString('en-US')} tokens. If the previous turn was cut off while emitting a tool input, retry with a smaller command, split large payloads into multiple calls, and do not print base64, secret files, or long heredocs into the chat.`,
            '',
            'Treat this as resuming the same turn, not starting a new one. The user did not send a follow-up message; the client re-issued the previous request transparently to recover from the interruption.',
          ].join('\n')
}
