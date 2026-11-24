import { tool } from 'ai'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { db } from '@/lib/db'

import { getConversationBySessionId } from './db'
import { attentionInputRequests } from './db/pending-decision'
import { withLabel } from './tools-skilled/labeling'

/** What a Task (or Bot, which is a Task) still owes. Open until `doneAt` is set. */
export type Todo = {
  _id: ObjectId
  userId: string
  teamId: string
  taskId: string
  title: string
  createdAt: Date
  doneAt?: Date
}

export const todos = () => db().collection<Todo>('agent_todos')

export async function setupTodoIndexes(): Promise<void> {
  await todos().createIndex(
    { teamId: 1, taskId: 1, doneAt: 1, createdAt: 1 },
    { name: 'todo_task_open' },
  )
}

const openFilter = (teamId: string, taskId: string) => ({
  teamId,
  taskId,
  doneAt: { $exists: false },
})

/** A Task's open to-dos, oldest first, capped so a runaway list stays readable. */
export function openTodos(teamId: string, taskId: string, limit = 100) {
  return todos().find(openFilter(teamId, taskId)).sort({ createdAt: 1 }).limit(limit).toArray()
}

type Waiting = { count: number; oldest?: Date }

/**
 * What the Task still waits on, named on every turn while anything is open so
 * neither its Inbox questions nor its to-dos are forgotten. Null when nothing is.
 */
export function pendingLine(inbox: Waiting, open: Waiting, now = new Date()): string | null {
  const part = (name: string, { count, oldest }: Waiting) => {
    if (count === 0 || !oldest) return null
    const hours = Math.floor((now.getTime() - oldest.getTime()) / 3_600_000)

    return `${name} ${String(count)} (oldest ${hours < 1 ? '<1' : String(hours)}h)`
  }
  const parts = [part('inbox', inbox), part('todos', open)].filter(Boolean)

  return parts.length > 0 ? `Pending: ${parts.join(', ')}.` : null
}

/** This turn's Pending line for a Task. A reminder only, so a failed read leaves it out. */
export async function turnPending(teamId: string, taskId: string): Promise<string | null> {
  try {
    const [conversation, count, first] = await Promise.all([
      getConversationBySessionId(taskId),
      todos().countDocuments(openFilter(teamId, taskId)),
      todos().findOne(openFilter(teamId, taskId), {
        sort: { createdAt: 1 },
        projection: { createdAt: 1 },
      }),
    ])
    const inbox = conversation ? attentionInputRequests(conversation) : []

    return pendingLine(
      { count: inbox.length, oldest: inbox[0]?.askedAt },
      { count, oldest: first?.createdAt },
    )
  } catch {
    return null
  }
}

const DESCRIPTION =
  "This Task's to-do list, kept across turns and restarts. Everything that needs your attention belongs in it, including the work you are doing now: add it when you take it on, mark it done when it is finished, and remove what is no longer needed by marking it done. " +
  "Use list to see what is open (the oldest 100). Each turn's prompt carries a Pending: line while anything is open."

export function createTodoTools(
  userId: string,
  taskId: string,
  teamId: string | null | undefined,
): Record<string, ReturnType<typeof withLabel>> {
  if (!teamId) return {}
  const shape = {
    action: z.enum(['add', 'done', 'list']),
    title: z.string().trim().min(1).max(300).optional().describe('For add: what needs doing.'),
    id: z.string().length(24).optional().describe('For done: the to-do id from add or list.'),
  }

  return {
    todos: withLabel(
      tool({
        description: DESCRIPTION,
        inputSchema: z.object(shape),
        execute: async ({ action, title, id }) => {
          if (action === 'add') {
            if (!title) throw new Error('add needs a title.')
            const todo: Todo = {
              _id: new ObjectId(),
              userId,
              teamId,
              taskId,
              title,
              createdAt: new Date(),
            }

            await todos().insertOne(todo)

            return { id: todo._id.toHexString() }
          }
          if (action === 'done') {
            if (!id || !ObjectId.isValid(id)) throw new Error('done needs the to-do id.')
            const { matchedCount } = await todos().updateOne(
              { _id: new ObjectId(id), ...openFilter(teamId, taskId) },
              { $set: { doneAt: new Date() } },
            )

            if (matchedCount === 0) throw new Error('No open to-do with that id in this Task.')

            return { done: id }
          }

          return {
            todos: (await openTodos(teamId, taskId)).map((todo) => ({
              id: todo._id.toHexString(),
              title: todo.title,
              createdAt: todo.createdAt.toISOString(),
            })),
          }
        },
      }),
      shape,
    ),
  }
}
