// A Task's to-do list against a real MongoDB: the open filter and the per-Task scope of done are
// query semantics a fake collection would only echo. Runs when TEST_MONGODB_URI is set.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'

import { createTodoTools, openTodos, setupTodoIndexes, todos } from './todos'

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

    expect((await openTodos(taskId)).map((todo) => todo.title)).toEqual(['second'])
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
})
