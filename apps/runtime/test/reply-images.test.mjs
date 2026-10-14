import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { nuphosReplyImages, nuphosUploadReplyImages } from '../image/reply-images.mjs'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1kAAAAASUVORK5CYII=',
  'base64',
)
const groupId = '0123456789abcdef01234567'
const marker = `https://nuphos.ai/_reply-images/${groupId}`
const env = {
  NUPHOS_TOKEN: 'test-only',
  NUPHOS_SESSION_ID: 'session',
  TEAM: 'team',
  NUPHOS_BACKEND_URL: 'https://backend.invalid',
}
async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'reply-images-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  await writeFile(join(cwd, '畫面 preview.png'), png)
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options })
    return {
      ok: true,
      json: async () =>
        String(url).endsWith('/finalize')
          ? { status: 'ready' }
          : {
              groupId,
              expiresAt: new Date(Date.now() + 60000).toISOString(),
              files: [{ uploadUrl: 'https://store.invalid/image' }],
            },
    }
  })
  return { cwd, calls, state: { cwd, env, cache: new Map() } }
}

test('uploads a Unicode/spaced path, file URL and relative path once; leaves remote URLs and code untouched', async (t) => {
  const { cwd, calls, state } = await fixture(t)
  const source = `![one](<${join(cwd, '畫面 preview.png')}>)\n![two](<${pathToFileURL(join(cwd, '畫面 preview.png'))}>)\n![three](%E7%95%AB%E9%9D%A2%20preview.png)\n![remote](https://example.com/img.png)\n\`![code](missing.png)\`\n\`\`\`md\n![example](missing.png)\n\`\`\``
  const output = await nuphosUploadReplyImages(source, state)
  assert.equal(output.split(marker).length, 4)
  assert.ok(output.includes('![example](missing.png)'))
  assert.ok(output.includes('![remote](https://example.com/img.png)'))
  assert.equal(calls.length, 3)
  assert.equal(calls[1].options.headers.Authorization, undefined)
  assert.deepEqual(calls[1].options.body, png)
})

test('rejects traversal, symlinks, oversized, missing and disguised non-images without uploading bytes', async (t) => {
  const { cwd, calls, state } = await fixture(t)
  const outside = await mkdtemp(join(tmpdir(), 'reply-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await writeFile(join(outside, 'secret.png'), png)
  await symlink(join(outside, 'secret.png'), join(cwd, 'link.png'))
  await writeFile(join(cwd, 'fake.png'), 'not an image')
  await writeFile(join(cwd, 'big.png'), Buffer.alloc(5 * 1024 * 1024 + 1))
  for (const file of [
    join(outside, 'secret.png'),
    'link.png',
    'fake.png',
    'big.png',
    'missing.png',
  ]) {
    const output = await nuphosUploadReplyImages(`![x](<${file}>)`, state)
    assert.match(output, /Image unavailable/)
    assert.ok(!output.includes(cwd))
  }
  assert.equal(calls.length, 0)
})

test('upload failures are visible and retried on a later reply', async (t) => {
  const { state, calls } = await fixture(t)
  globalThis.fetch.mock.mockImplementationOnce(async () => ({ ok: false }))
  const source = '![x](%E7%95%AB%E9%9D%A2%20preview.png)'
  assert.match(await nuphosUploadReplyImages(source, state), /could not be uploaded/)
  assert.match(await nuphosUploadReplyImages(source, state), /_reply-images/)
  assert.equal(calls.length, 3)
})

for (const provider of ['claude-code', 'codex'])
  test(`${provider}: split Markdown is uploaded before prompt completion, with plain text still streaming`, async (t) => {
    const { cwd, calls } = await fixture(t)
    const sent = []
    const agent = {
      prompt: async () => {
        const notify = (text) =>
          provider === 'codex'
            ? agent.connection.notify('session/update', {
                sessionId: 'native',
                update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
              })
            : agent.client.sessionUpdate({
                sessionId: 'native',
                update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
              })
        await notify('Here is the preview. ')
        assert.equal(sent.length, 1)
        await notify('!')
        await notify('[screen](%E7%95%AB%E9%9D%A2%20preview.png)')
        return { stopReason: 'end_turn' }
      },
    }
    if (provider === 'codex')
      agent.connection = { notify: async (method, value) => sent.push(value) }
    else agent.client = { sessionUpdate: async (value) => sent.push(value) }
    const meta =
      provider === 'codex' ? { 'ai.nuphos/codex': { env } } : { claudeCode: { options: { env } } }
    nuphosReplyImages(agent, { cwd, _meta: meta }, { sessionId: 'native' })
    // Production refreshes credentials at upload time; this isolated fixture uses its fake principal.
    agent.nuphosReplyImageState.get('native').credentialsDir = undefined
    await agent.prompt({ sessionId: 'native' })
    assert.equal(sent.length, 2)
    assert.match(sent[1].update.content.text, /_reply-images/)
    assert.equal(calls.length, 3)
  })
