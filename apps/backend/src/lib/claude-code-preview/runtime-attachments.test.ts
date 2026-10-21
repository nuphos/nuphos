import { expect, spyOn, test } from 'bun:test'

import * as transfers from '@/lib/file-transfer/service'

import { controlRegistry } from './agent-chat-registry'
import * as chatRoute from './conversation-chat-route'
import * as localFiles from './local-attachments'
import { attachmentPrompt } from './openab-acp-lifecycle'
import { materializeRuntimeAttachments, runtimeAttachments } from './runtime-attachments'

const scope = { teamId: '69e989027ab63e8d6a0ffcb6', userId: 'sender', sessionId: 'chat' }
const endpoint = { url: 'wss://runtime.example/acp', authKey: 'transport', runtimeId: 'rt' }
const control = { ...endpoint, authKey: 'control' }
const controlRoute = () =>
  spyOn(chatRoute, 'resolveConversationChatRuntime').mockResolvedValue({
    runtime: 'claude-code',
    endpoint: control,
  })

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
  expect(await materializeRuntimeAttachments('team', 'owner', endpoint, [])).toEqual([])
  const runJob = async (request: { stdin: string }) => {
    expect(JSON.parse(request.stdin).params.files).toEqual([
      { name: 'image.png', url: 'https://store.example/signed', size: 5 },
    ])

    return {
      exitCode: 0,
      stdout: JSON.stringify({ paths: ['/runtime/nuphos-attachments-test/0/image.png'] }),
    }
  }
  const route = controlRoute()
  const acquire = spyOn(controlRegistry, 'acquire').mockResolvedValue({ runJob } as never)
  const jobs = spyOn(controlRegistry, 'runtimeJobs').mockReturnValue(['panel'])

  try {
    const text = await materializeRuntimeAttachments('team', 'owner', endpoint, [
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
    // Runtime jobs need the operator credential; a turn only carries its transport endpoint.
    expect(route.mock.calls[0]).toEqual([
      'team',
      null,
      { userId: 'owner', runtimeId: 'rt', purpose: 'control' },
    ])
    expect(acquire.mock.calls[0]).toEqual(['team', control])
    route.mockResolvedValueOnce({
      runtime: 'claude-code',
      endpoint: { ...control, url: 'wss://other.example/acp' },
    })
    await expect(
      materializeRuntimeAttachments('team', 'owner', endpoint, [
        { name: 'a', url: 'https://store.example/signed', size: 1 },
      ]),
    ).rejects.toThrow('Conversation runtime changed')
    jobs.mockReturnValue([])
    await expect(
      materializeRuntimeAttachments('team', 'owner', endpoint, [
        { name: 'a', url: 'https://store.example/signed', size: 1 },
      ]),
    ).rejects.toThrow('Update this agent')
  } finally {
    route.mockRestore()
    acquire.mockRestore()
    jobs.mockRestore()
  }
})

test('a local runtime gets only the file list for its bundled attachments job', async () => {
  const requests: { job: string; stdin: string }[] = []
  const route = controlRoute()
  const acquire = spyOn(controlRegistry, 'acquire').mockResolvedValue({
    runJob: async (request: { job: string; stdin: string }) => {
      requests.push(request)

      return {
        exitCode: 0,
        stdout: JSON.stringify({ paths: ['/runtime/attachments/0/a.zip'] }),
      }
    },
  } as never)
  const jobs = spyOn(controlRegistry, 'runtimeJobs').mockReturnValue(['attachments'])
  const files = [{ name: 'a.zip', url: 'https://store.example/signed', size: 3 }]

  try {
    expect(await materializeRuntimeAttachments('team', 'owner', endpoint, files)).toEqual([
      { type: 'resource_link', name: 'a.zip', uri: 'file:///runtime/attachments/0/a.zip' },
    ])
    expect(requests[0]!.job).toBe('attachments')
    expect(JSON.parse(requests[0]!.stdin)).toEqual({ files })
  } finally {
    route.mockRestore()
    acquire.mockRestore()
    jobs.mockRestore()
  }
})

test('folder archives retain extraction instructions through the ACP text boundary', async () => {
  const resolve = spyOn(transfers, 'resolveDownloads').mockResolvedValue({
    files: [
      {
        fileName: 'folder.zip',
        downloadUrl: 'https://store.example/signed',
        size: 6,
        status: 'ready',
      },
    ],
  } as never)
  const acquire = spyOn(controlRegistry, 'acquire').mockResolvedValue({
    runJob: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ paths: ['/runtime/attachments/0/folder.zip'] }),
    }),
  } as never)
  const jobs = spyOn(controlRegistry, 'runtimeJobs').mockReturnValue(['panel'])
  const route = controlRoute()

  try {
    const files = await runtimeAttachments(
      [
        {
          type: 'data-attachment',
          data: { type: 'transfer-upload', groupId: 'folder', archive: true },
        },
      ],
      scope,
      [],
    )

    expect(files[0]!.archive).toBe(true)
    const links = await materializeRuntimeAttachments('team', 'owner', endpoint, files)
    const prompt = attachmentPrompt('chat', 'Inspect this folder', links, {})

    expect(prompt.prompt).toContainEqual({
      type: 'resource_link',
      name: 'folder.zip',
      uri: 'file:///runtime/attachments/0/folder.zip',
    })
    expect(JSON.stringify(prompt.prompt)).toContain(
      'Extract this local archive into a new directory',
    )
    expect(JSON.stringify(prompt.prompt)).not.toContain('https://store.example/signed')
  } finally {
    resolve.mockRestore()
    route.mockRestore()
    acquire.mockRestore()
    jobs.mockRestore()
  }
})

test('Windows absolute paths from the dedicated local downloader become Windows file URIs', async () => {
  const route = controlRoute()
  const download = spyOn(localFiles, 'localAttachments').mockResolvedValue(
    JSON.stringify({ paths: ['C:\\Users\\Pan Name\\圖片.png'] }),
  )
  const acquire = spyOn(controlRegistry, 'acquire')

  try {
    expect(
      await materializeRuntimeAttachments('team', 'owner', endpoint, [
        { name: '圖片.png', url: 'https://store.example/signed', size: 3 },
      ]),
    ).toEqual([
      {
        type: 'resource_link',
        name: '圖片.png',
        uri: 'file:///C:/Users/Pan%20Name/%E5%9C%96%E7%89%87.png',
      },
    ])
    expect(acquire).not.toHaveBeenCalled()
    download.mockResolvedValueOnce(JSON.stringify({ paths: ['C:relative.png'] }))
    await expect(
      materializeRuntimeAttachments('team', 'owner', endpoint, [
        { name: 'x', url: 'https://store.example/signed', size: 3 },
      ]),
    ).rejects.toThrow('invalid attachment paths')
  } finally {
    route.mockRestore()
    download.mockRestore()
    acquire.mockRestore()
  }
})
