import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { transferLinkedFile } from './linked-file-transfer.ts'

const group = {
  groupId: 'g',
  direction: 'upload',
  status: 'ready',
  label: null,
  files: [
    {
      id: 'f',
      fileName: 'clip.mp4',
      relPath: 'clip.mp4',
      size: 600_000,
      contentType: 'video/mp4',
      status: 'ready',
      downloadUrl: 'https://store/clip',
    },
  ],
}

test('linked media outside the runtime workspace transfers from this computer without a chat attachment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'linked-media-'))
  const workspace = join(root, 'workspace')
  const target = join(root, 'space and 中文', 'clip.mp4')
  const calls: unknown[] = []

  try {
    await mkdir(workspace)
    await mkdir(join(root, 'space and 中文'))
    await writeFile(target, Buffer.alloc(600_000))
    const result = await transferLinkedFile(['team', 'runtime', 'session', target], workspace, {
      uploadFiles: async (args) => {
        calls.push(args)

        return group
      },
      resolveDownloads: async (...args) => {
        calls.push(args)

        return group
      },
      transferRuntimeFile: async () => {
        throw new Error('must not read the runtime')
      },
    })

    assert.equal(result.origin, 'this-computer')
    assert.equal(result.url, 'https://store/clip')
    assert.deepEqual(calls, [{ teamId: 'team', filePaths: [target] }, ['team', undefined, 'g']])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('missing local paths and virtual workspace traversal stay on the runtime path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'linked-media-'))

  try {
    await mkdir(join(root, 'workspace'))
    await writeFile(join(root, 'outside.mp4'), 'outside')
    for (const [path, workspace] of [
      [join(root, 'missing.mp4'), root],
      ['/workspace/../outside.mp4', join(root, 'workspace')],
      ['/workspace/clip.mp4', null],
    ] as const) {
      const args: [string, string, string, string] = ['team', 'runtime', 'session', path]
      const result = await transferLinkedFile(args, workspace, {
        uploadFiles: async () => {
          throw new Error('must not upload')
        },
        resolveDownloads: async () => {
          throw new Error('must not resolve')
        },
        transferRuntimeFile: async (...actual) => {
          assert.deepEqual(actual, args)

          return {
            groupId: 'g',
            fileId: 'f',
            fileName: 'clip.mp4',
            size: 1,
            url: 'https://store/runtime',
          }
        },
      })

      assert.equal(result.origin, 'agent')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('local upload failures do not silently switch to a different runtime copy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'linked-media-'))
  const target = join(root, 'clip.mp4')

  try {
    await writeFile(target, 'video')
    for (const status of ['failed', 'ready']) {
      await assert.rejects(
        transferLinkedFile(['team', 'runtime', 'session', target], null, {
          uploadFiles: async () => group,
          resolveDownloads: async () => ({
            ...group,
            files: [{ ...group.files[0], status, downloadUrl: undefined }],
          }),
          transferRuntimeFile: async () => {
            throw new Error('wrong fallback')
          },
        }),
        /could not be prepared/,
      )
    }
    await assert.rejects(
      transferLinkedFile(['team', 'runtime', 'session', target], null, {
        uploadFiles: async () => {
          throw new Error('file too large')
        },
        resolveDownloads: async () => group,
        transferRuntimeFile: async () => {
          throw new Error('wrong fallback')
        },
      }),
      /file too large/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
