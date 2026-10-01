// Fire a real monitoring trigger from the terminal and show what the agent
// actually did with it — the trigger-run counterpart to agent-drive.ts, which
// can only drive ordinary user turns and so never reaches the incident path.
//
//   # look first: prints the destination and the recorded history, posts nothing
//   bun scripts/trigger-drive.ts --trigger 66f0...
//
//   # then actually fire it
//   bun scripts/trigger-drive.ts --trigger 66f0... --fire \
//     --require 'incident_history' --before 'incident_history' --then 'slack_post' \
//     --expect-delivered
//
// THIS POSTS TO SLACK. The trigger's approved destination is a real channel, so
// firing is a real notification to whoever is in it. That is why --fire is
// required and the default is a dry run.
//
// Runs the trigger in-process rather than through a dev server: `bun --hot`
// does not pull newly added modules into an already-running backend, so a
// server started before your new file exists would run the old graph.
//
// Exit codes: 0 = ran and every assertion held, 1 = assertion failed, 2 = the
// run produced no agent turn at all.
import { ObjectId } from 'mongodb'

import { agentMessages } from '@/lib/agent/db'
import { agentTriggers } from '@/lib/agent/trigger-db'
import { executeTrigger } from '@/lib/agent/trigger-executor'
import { connectDb } from '@/lib/db'
import { listIncidentOccurrences } from '@/lib/slack/incident-occurrences'

type Args = {
  trigger?: string
  status: string
  alert: string
  detail?: string
  fire: boolean
  scope?: string
  require: string[]
  forbid: string[]
  before?: string
  after?: string
  expectDelivered: boolean
}

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    status: 'firing',
    alert: 'trigger-drive synthetic alert',
    fire: false,
    require: [],
    forbid: [],
    expectDelivered: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = () => {
      const next = argv[++i]

      if (next === undefined) fail(`${flag} needs a value`)

      return next!
    }

    switch (flag) {
      case '--trigger':
        args.trigger = value()
        break
      // Whatever the provider would have said. The server no longer maps
      // these onto a lifecycle, so anything is valid — including 'degraded'.
      case '--status':
        args.status = value()
        break
      // Distinct alert identity, for testing that genuinely different problems
      // are NOT merged into one thread.
      case '--alert':
        args.alert = value()
        break
      case '--detail':
        args.detail = value()
        break
      case '--scope':
        args.scope = value()
        break
      case '--fire':
        args.fire = true
        break
      case '--require':
        args.require.push(value())
        break
      case '--forbid':
        args.forbid.push(value())
        break
      case '--before':
        args.before = value()
        break
      case '--then':
        args.after = value()
        break
      case '--expect-delivered':
        args.expectDelivered = true
        break
      default:
        fail(`unknown flag ${flag}`)
    }
  }

  return args
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ')

  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** The synthetic webhook body a provider would have sent. */
function syntheticPayload(args: Args): Record<string, unknown> {
  return {
    status: args.status,
    alertName: args.alert,
    ...(args.detail ? { detail: args.detail } : {}),
    firedAt: new Date().toISOString(),
    labels: { source: 'trigger-drive', severity: 'warning' },
  }
}

/** Tool calls of one stored turn, in the order the model made them. */
async function readToolTrace(
  sessionId: string,
): Promise<{ name: string; input: string; output: string }[]> {
  const messages = await agentMessages().find({ sessionId }).sort({ createdAt: 1 }).toArray()
  const calls: { name: string; input: string; output: string }[] = []

  for (const message of messages) {
    for (const part of (message.parts ?? []) as Record<string, unknown>[]) {
      const type = String(part.type ?? '')
      // Stored transcripts use a plain `tool` part carrying toolName; the
      // streaming frames use `tool-<name>`. Accept both so this reads the same
      // turn whether it came from Mongo or a live stream.
      const name =
        type === 'tool'
          ? String(part.toolName ?? '')
          : type.startsWith('tool-')
            ? type.slice('tool-'.length)
            : ''

      if (!name || name === 'output-available' || name === 'input-available') continue
      calls.push({
        name,
        input: JSON.stringify(part.input ?? {}),
        output: JSON.stringify(part.output ?? {}),
      })
    }
  }

  return calls
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!args.trigger) fail('--trigger <triggerId> is required')
  if (!ObjectId.isValid(args.trigger)) fail('--trigger must be a trigger id')

  await connectDb()
  const trigger = await agentTriggers().findOne({ _id: new ObjectId(args.trigger) })

  if (!trigger) fail(`no trigger ${args.trigger}`)

  const destination = trigger.slackDestination
  const channelWorkspace = (dest: { slackWorkspaceId?: string }) =>
    dest.slackWorkspaceId ? ` in ${dest.slackWorkspaceId}` : ''

  console.log(`trigger:     ${trigger.name} (${args.trigger})`)
  console.log(`team:        ${trigger.teamId ?? '(none)'}`)
  console.log(`incidentMode:${trigger.incidentMode ? ' on' : ' off'}`)
  console.log(
    `destination: ${
      destination
        ? destination.type === 'channel'
          ? `channel ${destination.channelId}${channelWorkspace(destination)}`
          : destination.type
        : '(none)'
    }`,
  )

  const scope = args.scope ?? 'default'

  if (trigger.teamId) {
    const occurrences = await listIncidentOccurrences({
      teamId: trigger.teamId,
      triggerId: args.trigger,
      incidentScope: scope,
      limit: 10,
    })

    console.log(`history:     ${occurrences.length} recorded occurrence(s)`)
    for (const occurrence of occurrences) {
      const lastMessage = occurrence.lastMessage ? `: ${truncate(occurrence.lastMessage, 120)}` : ''
      const thread = occurrence.slackThreadTs ? ` ${occurrence.slackThreadTs}` : ' (never posted)'

      console.log(
        `  - ${occurrence.firedAt.toISOString()}` +
          ` [${occurrence.reportedStatus ?? 'no status'}]` +
          `${occurrence.startedNewThread ? ' own thread' : ' continued a thread'}${
            thread
          }${lastMessage}`,
      )
    }
  }

  if (!args.fire) {
    console.log('\ndry run — pass --fire to actually run the trigger (this posts to Slack)')
    process.exit(0)
  }

  console.log(`\nfiring "${args.alert}" (status: ${args.status})…\n`)
  const sessionId = await executeTrigger(trigger, syntheticPayload(args), {
    incidentScope: scope,
  })

  if (!sessionId) {
    console.error('✗ the trigger produced no agent run')
    process.exit(2)
  }

  const calls = await readToolTrace(sessionId)

  console.log(`session: ${sessionId}`)
  for (const [index, call] of calls.entries()) {
    console.log(`  ${index + 1}. ${call.name} ${truncate(call.input, 300)}`)
  }

  const haystack = calls.map((call) => `${call.name} ${call.input}`)
  let failed = false

  for (const pattern of args.require) {
    if (!haystack.some((entry) => new RegExp(pattern, 'i').test(entry))) {
      console.error(`✗ required /${pattern}/ never ran`)
      failed = true
    }
  }
  for (const pattern of args.forbid) {
    const hit = haystack.find((entry) => new RegExp(pattern, 'i').test(entry))

    if (hit) {
      console.error(`✗ forbidden /${pattern}/ ran: ${truncate(hit, 200)}`)
      failed = true
    }
  }
  // Ordering is the whole point for an incident run: looking after you have
  // already posted is the same as not looking.
  if (args.before && args.after) {
    const first = haystack.findIndex((entry) => new RegExp(args.before!, 'i').test(entry))
    const second = haystack.findIndex((entry) => new RegExp(args.after!, 'i').test(entry))

    if (first === -1 || second === -1 || first > second) {
      console.error(
        `✗ expected /${args.before}/ before /${args.after}/ (positions ${first} and ${second})`,
      )
      failed = true
    }
  }

  // A run can call every tool in the right order and still notify nobody: a
  // rejected post leaves the trace looking healthy. Assert the delivery
  // itself, or "no Slack message at all" reads as success.
  if (args.expectDelivered) {
    const delivered = calls.some(
      (call) => call.name === 'slack_post' && /"ok"\s*:\s*true/.test(call.output),
    )

    if (!delivered) {
      const attempts = calls.filter((call) => call.name === 'slack_post').length

      console.error(
        `✗ no slack_post succeeded (${attempts} attempt(s)) — the firing notified nobody`,
      )
      failed = true
    }
  }

  console.log(failed ? '\n✗ assertions failed' : '\n✓ ok')
  process.exit(failed ? 1 : 0)
}

void main()
