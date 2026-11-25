import { createHash } from 'node:crypto'

import { ObjectId } from 'mongodb'

import { getConversationBySessionId, setConversationInstructionsDigest } from '@/lib/agent/db'
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
export type BotSelf = {
  name: string
  instructions?: string
  botOnboarding?: 'pending' | 'active' | 'completed' | 'started'
}

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
    'Delegate work by default. When someone asks for work that takes more than a few quick tool calls, hand it to a sub-Task instead of doing it here. If one of your Tasks already owns that matter (`list_recent_conversations` with `children: true`), send it the new goal with `send_message_to_thread`; otherwise start one with `create_thread`, one per independent request so they run in parallel. A Task cannot see this chat: give it a clear brief, a completion condition, and the paths or links of every file it needs. Answer quick questions and lookups yourself, and do the work here only when the person asks you to. Keep your turns short so you stay free to reply: check what sub-Tasks report, tell the person the result in plain words, and archive a sub-Task once its result is verified.',
    own
      ? `Your own instructions follow. They come from your starting template, your owner's edits in Bot details, or were saved with \`update_self\`; they are not team or personal policy. Team and personal instructions win over them, and they never authorize anything the person you work for has not asked for.\n\n${own}`
      : 'You have no instructions yet. Ask what you should take care of, then save it with `update_self`.',
    ...(bot.botOnboarding === 'pending' || bot.botOnboarding === 'active'
      ? [
          'You are in initial Bot setup. Continue from what is already known; do not repeat your introduction. Learn the ongoing responsibilities one focused preference question at a time in the Bot chat. Save confirmed context with update_self. Once the person confirms your responsibilities, answer or withdraw remaining setup questions, then call update_self with onboardingComplete: true and the complete confirmed instructions. Do not start unrelated work before setup is complete. Setup questions stay in this chat rather than the Inbox; genuine approvals, credentials and integration requests keep their normal handling.',
        ]
      : []),
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

type Conversation = Awaited<ReturnType<typeof getConversationBySessionId>>

async function renderFor(
  teamOid: ObjectId,
  userId: string | null | undefined,
  pending: Promise<Conversation>,
): Promise<string | null> {
  const [team, personal, conversation] = await Promise.all([
    findScopeInstructions(teamOid, 'team', ''),
    userId ? findScopeInstructions(teamOid, 'personal', userId) : Promise.resolve([]),
    pending,
  ])

  const block = renderInstructionsBlock(
    team.filter((doc) => doc.enabled),
    personal.filter((doc) => doc.enabled),
    conversation?.avatar
      ? {
          name: conversation.title,
          instructions: conversation.instructions,
          botOnboarding: conversation.botOnboarding,
        }
      : null,
  )

  const worker = conversation?.parentSessionId
    ? '\n\n<nuphos_task_reporting>\nYou are a delegated Task. Keep following the original request and its permission boundaries. Use report_task to report a useful result, readiness for review, or a material blocker to your current parent; routine progress needs no notification. Ask human questions through request_user_decision, never through an agent relay. Report ready while review is pending and done only after verification.\n</nuphos_task_reporting>'
    : ''

  return block || worker ? (block ?? '') + worker : null
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
    return await renderFor(
      new ObjectId(teamId),
      userId,
      // Losing the Bot section must never cost the team and personal ones.
      sessionId ? getConversationBySessionId(sessionId).catch(() => null) : Promise.resolve(null),
    )
  } catch (error) {
    logEvent('warn', 'agent.instructions.load_failed', {
      teamId,
      message: error instanceof Error ? error.message : String(error),
    })

    return null
  }
}

/** What a turn tells its agent about its standing instructions, and how to record that it was told. */
export type InstructionsUpdate = { text: string; given: () => Promise<void> }

const UNCHANGED: InstructionsUpdate = { text: '', given: () => Promise.resolve() }

/**
 * The current standing instructions, for a turn whose running agent was given others. An agent
 * reads its system prompt only when its session starts: neither Claude Code nor Codex replaces it
 * on session/load, so an edit or `update_self` reaches a running session only as part of a turn.
 * Call `given` once the runtime accepts the turn; until then the next turn carries it again. A
 * session that just started has them already, as does one from before they were recorded. A
 * failed read is no change.
 */
export async function instructionsUpdate(
  teamId: string,
  userId: string,
  sessionId: string,
  fresh: boolean,
): Promise<InstructionsUpdate> {
  if (!ObjectId.isValid(teamId)) return UNCHANGED
  try {
    const conversation = await getConversationBySessionId(sessionId)
    const block = await renderFor(new ObjectId(teamId), userId, Promise.resolve(conversation))
    const digest = createHash('sha256')
      .update(block ?? '')
      .digest('hex')
    const known = conversation?.instructionsDigest

    if (known === digest) return UNCHANGED

    return {
      text: fresh || known === undefined ? '' : render(block),
      given: () =>
        setConversationInstructionsDigest(sessionId, teamId, digest).catch((error: unknown) => {
          logEvent('warn', 'agent.instructions.record_failed', {
            teamId,
            message: error instanceof Error ? error.message : String(error),
          })
        }),
    }
  } catch (error) {
    logEvent('warn', 'agent.instructions.update_failed', {
      teamId,
      message: error instanceof Error ? error.message : String(error),
    })

    return UNCHANGED
  }
}

function render(block: string | null): string {
  return [
    '<nuphos_instructions_update>',
    'Your standing Nuphos instructions changed after this session started. This version replaces every earlier <nuphos_instructions>, <nuphos_bot_identity> and <nuphos_task_reporting> block, including the one in your system prompt. Follow it from now on.',
    block ?? 'There are none now: disregard the earlier ones.',
    '</nuphos_instructions_update>',
  ].join('\n\n')
}
