import { ObjectId } from 'mongodb'

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

export function renderInstructionsBlock(
  team: InstructionSnippet[],
  personal: InstructionSnippet[],
): string | null {
  const sections = [
    ...renderGroup('Team instructions', team),
    ...renderGroup('Personal instructions', personal),
  ]

  if (sections.length === 0) return null

  return [
    '<nuphos_instructions>',
    'The user and their team configured these standing instructions in Nuphos. Follow them in this conversation the way you would follow CLAUDE.md or AGENTS.md. When a personal instruction conflicts with a team instruction, the personal one wins unless the team instruction is a hard policy.',
    '',
    sections.join('\n\n'),
    '</nuphos_instructions>',
  ].join('\n')
}

/**
 * Enabled team and personal instructions for one member, rendered as a system
 * context block. Returns null when there are none, and fails soft so a store
 * outage never blocks a conversation from starting.
 */
export async function loadInstructionsBlock(
  teamId: string,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!ObjectId.isValid(teamId)) return null
  try {
    const teamOid = new ObjectId(teamId)
    const [team, personal] = await Promise.all([
      findScopeInstructions(teamOid, 'team', ''),
      userId ? findScopeInstructions(teamOid, 'personal', userId) : Promise.resolve([]),
    ])

    return renderInstructionsBlock(
      team.filter((doc) => doc.enabled),
      personal.filter((doc) => doc.enabled),
    )
  } catch (error) {
    logEvent('warn', 'agent.instructions.load_failed', {
      teamId,
      message: error instanceof Error ? error.message : String(error),
    })

    return null
  }
}
