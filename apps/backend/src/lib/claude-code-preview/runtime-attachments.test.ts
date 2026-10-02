import { expect, spyOn, test } from 'bun:test'

import * as transfers from '@/lib/file-transfer/service'

import { controlRegistry } from './agent-chat-registry'
import { materializeRuntimeAttachments, runtimeAttachments } from './runtime-attachments'

const scope = { teamId: '69e989027ab63e8d6a0ffcb6', userId: 'sender', sessionId: 'chat' }
const endpoint = { url: 'wss://runtime.example/acp', authKey: 'test' }

test('current-turn transfers use the sender and conversation scope, including restored parts', async () => {
  const resolve = spyOn(transfers, 'resolveDownloads').mockResolvedValue({
    files: [
      {
        fileName: 'report.txt',
        downloadUrl: 'https://store.example/signed',
        size: 6,
        status: 'ready',
      },
    ],
  } as Awaited<ReturnType<typeof transfers.resolveDownloads>>)

  try {
    const transfer = { type: 'transfer-upload', groupId: 'group', status: 'ready' }

    for (const part of [transfer, { type: 'data-attachment', data: transfer }]) {
      expect(await runtimeAttachments([part], scope, [])).toEqual([
        { name: 'report.txt', url: 'https://store.example/signed', size: 6 },
      ])
    }
    expect(resolve.mock.calls[0]![0]).toMatchObject({ userId: 'sender', sessionId: 'chat' })
    expect(resolve.mock.calls[0]![0].teamId.toHexString()).toBe(scope.teamId)
  } finally {
    resolve.mockRestore()
  }
})

test('materialization is a no-op for text turns and exposes only paths to the model', async () => {
  expect(await materializeRuntimeAttachments('team', endpoint, [])).toEqual([])
  const runJob = async (request: { stdin: string }) => {
    expect(JSON.parse(request.stdin).params.files).toEqual([
      { name: 'image.png', url: 'https://store.example/signed', size: 5 },
    ])

    return {
      exitCode: 0,
      stdout: JSON.stringify({ paths: ['/runtime/nuphos-attachments-test/0/image.png'] }),
    }
  }
  const acquire = spyOn(controlRegistry, 'acquire').mockResolvedValue({ runJob } as never)
  const jobs = spyOn(controlRegistry, 'runtimeJobs').mockReturnValue(['panel'])

  try {
    const text = await materializeRuntimeAttachments('team', endpoint, [
      { name: 'image.png', url: 'https://store.example/signed', size: 5 },
    ])

    expect(text).toEqual([
      {
        type: 'resource_link',
        name: 'image.png',
        uri: 'file:///runtime/nuphos-attachments-test/0/image.png',
      },
    ])
    expect(JSON.stringify(text)).not.toContain('https://store.example/signed')
    expect(JSON.stringify(text)).not.toContain('upload_attachment')
    jobs.mockReturnValue([])
    await expect(
      materializeRuntimeAttachments('team', endpoint, [
        { name: 'a', url: 'https://store.example/signed', size: 1 },
      ]),
    ).rejects.toThrow('Update this agent')
  } finally {
    acquire.mockRestore()
    jobs.mockRestore()
  }
})
