import assert from 'node:assert/strict'
import { before, beforeEach, mock, test } from 'node:test'

type Call = { file: string; args: string[]; stdin: string }

const calls: Call[] = []
let reply: { error: Error | null; stdout: string } = { error: null, stdout: '{}' }
let consent = true

let cli: typeof import('./github-cli.ts')

before(async () => {
  mock.module('node:child_process', {
    namedExports: {
      execFile: (
        file: string,
        args: string[],
        _opts: unknown,
        done: (error: Error | null, stdout: string) => void,
      ) => {
        const call: Call = { file, args, stdin: '' }

        calls.push(call)
        setImmediate(() => done(reply.error, reply.stdout))

        return {
          stdin: {
            end: (data: string) => {
              call.stdin = data
            },
          },
        }
      },
    },
  })
  mock.module('./shell-env.ts', { namedExports: { resolveShellEnv: async () => ({}) } })
  mock.module('./agent/cloud-cli-probe-core.ts', {
    namedExports: { findExecutable: async () => ({ path: '/opt/homebrew/bin/gh' }) },
  })
  mock.module('./consent.ts', { namedExports: { requireNativeConsent: async () => consent } })
  cli = await import('./github-cli.ts')
})

beforeEach(() => {
  calls.length = 0
  reply = { error: null, stdout: '{}' }
  consent = true
})

const pull = { owner: 'nuphos', repo: 'nuphos', number: 50 }
const sha = 'a'.repeat(40)
const sender = {} as Parameters<typeof cli.githubCliMerge>[0]

test('comments go to github.com through the gh found on PATH, body on stdin', async () => {
  assert.deepEqual(await cli.githubCliComment(pull, 'looks good'), { ok: true })
  assert.equal(calls[0].file, '/opt/homebrew/bin/gh')
  assert.deepEqual(calls[0].args, [
    'api',
    '--hostname',
    'github.com',
    '--method',
    'POST',
    'repos/nuphos/nuphos/issues/50/comments',
    '--input',
    '-',
  ])
  assert.deepEqual(JSON.parse(calls[0].stdin), { body: 'looks good' })
})

test('a malformed pull reference never reaches gh', async () => {
  await assert.rejects(cli.githubCliComment({ ...pull, owner: '../x' }, 'hi'))
  await assert.rejects(cli.githubCliReview(pull, 'DISMISS' as never, 'hi'))
  await assert.rejects(cli.githubCliMerge(sender, pull, 'squash', 'HEAD'))
  assert.equal(calls.length, 0)
})

test('GitHub explains a refused write; other failures get a fixed message', async () => {
  reply = { error: new Error('exit 1'), stdout: '{"message":"Pull Request is not mergeable"}' }
  assert.deepEqual(await cli.githubCliMerge(sender, pull, 'squash', sha), {
    ok: false,
    message: 'Pull Request is not mergeable',
  })
  reply = { error: new Error('exit 1'), stdout: 'not json' }
  assert.deepEqual(await cli.githubCliComment(pull, 'hi'), {
    ok: false,
    message: 'GitHub CLI request failed.',
  })
})

test('a merge pins the head SHA and does nothing without native consent', async () => {
  await cli.githubCliMerge(sender, pull, 'rebase', sha)
  assert.deepEqual(JSON.parse(calls[0].stdin), { merge_method: 'rebase', sha })

  consent = false
  calls.length = 0
  assert.equal((await cli.githubCliMerge(sender, pull, 'rebase', sha)).ok, false)
  assert.equal(calls.length, 0)
})

test('the viewer is null when gh is signed out', async () => {
  reply = { error: new Error('exit 4'), stdout: '' }
  assert.equal(await cli.githubCliViewer(), null)
  reply = { error: null, stdout: '{"login":"yuaanlin","avatar_url":"https://a"}' }
  assert.deepEqual(await cli.githubCliViewer(), { login: 'yuaanlin', avatarUrl: 'https://a' })
  assert.deepEqual(calls[1].args.slice(-2), ['GET', 'user'])
})
