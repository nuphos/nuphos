import { client, must } from './binding-access-scenarios.ts'
import { askOverMcp, mcp } from './mcp-scenarios.ts'

import type { Scenario } from './ui.ts'

export const mcpFileScenarios: Scenario[] = [
  {
    name: 'an MCP client retrieves a Task’s published binary evidence from the transfer store',
    run: async (_page, stack) => {
      const { execFileSync } = await import('node:child_process')
      const as = client(stack.apiUrl, stack.token)
      const { tool } = mcp(as)
      const task = await askOverMcp(tool, stack.teamId, 'E2E_DELIVERY:mcp-files')
      const bytes = new Uint8Array([0, 255, 1, 0, 128, 10, 13, 42])
      const transfers = `/teams/${stack.teamId}/file-transfers`
      const created = await as('POST', transfers, {
        direction: 'download',
        files: [
          { fileName: 'evidence.bin', size: bytes.length, contentType: 'application/octet-stream' },
        ],
      })
      const group = created.body as { groupId: string; files: { uploadUrl: string }[] }

      must(created.status === 201, `the transfer to be created, got ${created.text}`)
      const put = await fetch(group.files[0].uploadUrl, { method: 'PUT', body: bytes })

      must(put.ok, 'the evidence bytes to upload')
      const finalized = await as('POST', `${transfers}/${group.groupId}/finalize`, {})

      must(finalized.status === 200, 'the transfer to finalize')
      const stamp = `
        import { MongoClient, ObjectId } from 'mongodb'
        const client = await new MongoClient(process.argv[1]).connect()
        await client.db('nuphos_e2e').collection('file_transfer_groups').updateOne(
          { _id: new ObjectId(process.argv[2]) }, { $set: { sessionId: process.argv[3] } })
        await client.close()`

      execFileSync('bun', ['-e', stamp, stack.mongoUri, group.groupId, task], {
        cwd: new URL('../../apps/backend', import.meta.url),
        timeout: 10_000,
      })
      const result = await tool<{ groups: { files: { downloadUrl?: string }[] }[] }>(
        'nuphos_files',
        { session_id: task },
      )

      must(result.isError !== true, `MCP files to succeed, got ${JSON.stringify(result)}`)
      const url = result.structuredContent?.groups[0]?.files[0]?.downloadUrl

      must(typeof url === 'string', 'the existing store’s signed download URL')
      const downloaded = new Uint8Array(await (await fetch(url)).arrayBuffer())

      must(
        JSON.stringify([...downloaded]) === JSON.stringify([...bytes]),
        'the exact binary evidence bytes',
      )
      const other = await askOverMcp(tool, stack.teamId, 'E2E_DELIVERY:mcp-files-other')
      const excluded = await tool<{ groups: unknown[] }>('nuphos_files', { session_id: other })

      must(
        excluded.structuredContent?.groups.length === 0,
        'another Task to have none of this Task’s files',
      )
    },
  },
]
