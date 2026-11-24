// A Task's to-do list against a real MongoDB: the open filter and the per-Task scope of done are
// query semantics a fake collection would only echo. Runs when TEST_MONGODB_URI is set.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { withPageContext } from '@/lib/claude-code-preview/preview-prompt'
import { closeDb, connectDb } from '@/lib/db'

import { createTodoTools, openTodos, setupTodoIndexes, todos, turnPending } from './todos'

const teamId = new ObjectId().toHexString()
const taskId = `todo-test-${teamId}`
const otherTask = `${taskId}-other`

type Run = (input: Record<string, unknown>) => Promise<Record<string, unknown>>
const tools = (task: string) =>
  createTodoTools('u', task, teamId) as unknown as { todos: { execute: Run } }
const run = (task: string, input: Record<string, unknown>) =>
  tools(task).todos.execute({ label: 'x', ...input })

describe.skipIf(!process.env.TEST_MONGODB_URI)('a Task to-do list', () => {
  beforeAll(async () => {
    await connectDb()
    await setupTodoIndexes()
  })

  afterAll(async () => {
    await todos().deleteMany({ taskId: { $in: [taskId, otherTask] } })
    await closeDb()
  })

  test('lists what is open, oldest first, and drops what is done', async () => {
    const first = await run(taskId, { action: 'add', title: 'first' })

    await run(taskId, { action: 'add', title: 'second' })
    await run(taskId, { action: 'done', id: first.id })

    expect((await openTodos(teamId, taskId)).map((todo) => todo.title)).toEqual(['second'])
    expect(await run(taskId, { action: 'list' })).toMatchObject({
      todos: [{ title: 'second' }],
    })
  })

  test("another Task cannot close this one's to-do, and done does not repeat", async () => {
    const { id } = await run(taskId, { action: 'add', title: 'mine' })

    await expect(run(otherTask, { action: 'done', id })).rejects.toThrow('No open to-do')
    await run(taskId, { action: 'done', id })
    await expect(run(taskId, { action: 'done', id })).rejects.toThrow('No open to-do')
  })

  test('a to-do is reached only through its own team', async () => {
    const { id } = await run(taskId, { action: 'add', title: 'scoped' })

    expect(await openTodos(new ObjectId().toHexString(), taskId)).toEqual([])
    await run(taskId, { action: 'done', id })
  })

  test('the turn names open to-dos in its page context, and drops the line when none are', async () => {
    await todos().deleteMany({ taskId })
    expect(await turnPending(teamId, taskId)).toBeNull()
    expect(await withPageContext(undefined, { teamId, sessionId: taskId })).toBeUndefined()

    const { id } = await run(taskId, { action: 'add', title: 'waiting' })

    expect(await turnPending(teamId, taskId)).toBe('Pending: todos 1 (oldest <1h).')
    expect(await withPageContext('ctx', { teamId, sessionId: taskId })).toBe(
      'ctx\n\nPending: todos 1 (oldest <1h).',
    )
    await run(taskId, { action: 'done', id })
  })
})
