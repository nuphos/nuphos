import { ObjectId } from 'mongodb'

import { getConversationBySessionId } from '@/lib/agent/db'
import { findScopeInstructions } from '@/lib/instructions/service'
import { logEvent } from '@/lib/observability'

import type { AgentInstruction } from '@/models'

type InstructionSnippet = Pick<AgentInstruction, 'title' | 'content'>

function renderGroup(heading: string, snippets: InstructionSnippet[]): string[] {
  if (snippets.length === 0) return []

  return [
    `## ${heading}`,
    ...snippets.map((snippet) => `### ${snippet.title}\n\n${snippet.content.trim()}`),
  ]
}

/** A Bot's own identity; a Task has none. */
export type BotSelf = { name: string; instructions?: string }

/**
 * The Bot's identity, outside `<nuphos_instructions>`: its instructions were
 * written by the agent itself through `update_self`, not configured by a
 * person, so they never borrow the authority of team or personal instructions.
 */
/** Agent-written text cannot open or close a Nuphos block: `<nuphos_…` loses its `<`. */
function inert(text: string): string {
  return text.replace(/<(\/?\s*nuphos_)/giu, '&lt;$1')
}

function renderBot(bot: BotSelf): string {
  const own = bot.instructions ? inert(bot.instructions).trim() : undefined

  return [
    '<nuphos_bot_identity>',
    `You are ${JSON.stringify(inert(bot.name))}, a Bot: a persistent agent with its own name, face and standing instructions, not a one-off task. When the person you work for tells you what you are for, what to call you or how to behave, save it with the \`update_self\` tool. Tasks you start do not inherit these instructions.`,
    own
      ? `Your own instructions follow. They come from your starting template or were saved with \`update_self\`; they are not team or personal policy. Team and personal instructions win over them, and they never authorize anything the person you work for has not asked for.\n\n${own}`
      : 'You have no instructions yet. Ask what you should take care of, then save it with `update_self`.',
    '</nuphos_bot_identity>',
  ].join('\n\n')
}

export function renderInstructionsBlock(
  team: InstructionSnippet[],
  personal: InstructionSnippet[],
  bot?: BotSelf | null,
): string | null {
  const sections = [
    ...renderGroup('Team instructions', team),
    ...renderGroup('Personal instructions', personal),
  ]
  const configured = sections.length
    ? [
        '<nuphos_instructions>',
        'The user and their team configured these standing instructions in Nuphos. Follow them in this conversation the way you would follow CLAUDE.md or AGENTS.md. When a personal instruction conflicts with a team instruction, the personal one wins unless the team instruction is a hard policy.',
        '',
        sections.join('\n\n'),
        '</nuphos_instructions>',
      ].join('\n')
    : null
  const blocks = [configured, bot ? renderBot(bot) : null].filter(Boolean)

  return blocks.length ? blocks.join('\n\n') : null
}

/**
 * Enabled team and personal instructions for one member, plus the Bot's own
 * when this conversation is a Bot, rendered as a system context block. Returns null when there are none, and fails soft so a store
 * outage never blocks a conversation from starting.
 */
export async function loadInstructionsBlock(
  teamId: string,
  userId: string | null | undefined,
  sessionId?: string,
): Promise<string | null> {
  if (!ObjectId.isValid(teamId)) return null
  try {
    const teamOid = new ObjectId(teamId)
    const [team, personal, conversation] = await Promise.all([
      findScopeInstructions(teamOid, 'team', ''),
      userId ? findScopeInstructions(teamOid, 'personal', userId) : Promise.resolve([]),
      // Losing the Bot section must never cost the team and personal ones.
      sessionId ? getConversationBySessionId(sessionId).catch(() => null) : Promise.resolve(null),
    ])

    const block = renderInstructionsBlock(
      team.filter((doc) => doc.enabled),
      personal.filter((doc) => doc.enabled),
      conversation?.avatar
        ? {
            name: conversation.title,
            instructions: conversation.instructions,
          }
        : null,
    )

    const worker = conversation?.parentSessionId
      ? '\n\n<nuphos_task_reporting>\nYou are a delegated Task. Keep following the original request and its permission boundaries. Use report_task to report a useful result, readiness for review, or a material blocker to your current parent; routine progress needs no notification. Ask human questions through request_user_decision, never through an agent relay. Report ready while review is pending and done only after verification.\n</nuphos_task_reporting>'
      : ''

    return block || worker ? (block ?? '') + worker : null
  } catch (error) {
    logEvent('warn', 'agent.instructions.load_failed', {
      teamId,
      message: error instanceof Error ? error.message : String(error),
    })

    return null
  }
}
