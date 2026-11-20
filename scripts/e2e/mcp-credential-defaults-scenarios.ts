import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import { defaultCredentialAccess } from '../../apps/desktop/src/components/agent/panel/credentialAccess.ts'

import { client, must } from './binding-access-scenarios.ts'
import { askOverMcp, mcp } from './mcp-scenarios.ts'
import { until } from './processes.ts'

import type { Scenario } from './ui.ts'
import type { AgentCredentialOptions } from '../../apps/desktop/src/api/agent-credential-types.ts'

export const mcpCredentialDefaultsScenarios: Scenario[] = [
  {
    name: 'new MCP and app Tasks select the same default credentials',
    run: async (_page, stack) => {
      const backup = `
        import { MongoClient, ObjectId } from 'mongodb'
        import { EJSON } from 'bson'
        const c = await new MongoClient(process.argv[1]).connect()
        const row = await c.db('nuphos_e2e').collection('team_byos_bindings').findOne({_id:new ObjectId(process.argv[2])})
        console.log(EJSON.stringify(row))
        await c.close()`
      const original = execFileSync('bun', ['-e', backup, stack.mongoUri, stack.teamId], {
        cwd: new URL('../../apps/backend', import.meta.url),
      }).toString()

      try {
        const seed = `
        import { MongoClient, ObjectId } from 'mongodb'
        const c = await new MongoClient(process.argv[1]).connect()
        await c.db('nuphos_e2e').collection('team_byos_bindings').updateOne(
          {_id:new ObjectId(process.argv[2])}, {$set:{
            awsRoles:[{id:new ObjectId('000000000000000000000001'),roleArn:'arn:aws:iam::123456789012:role/Fictional'}],
            githubInstallations:[{installationId:123456,accountLogin:'fictional',accountType:'Organization'}],
            grafanaInstances:[{id:new ObjectId('000000000000000000000002'),name:'Fictional',grafanaUrl:'https://example.invalid'}],
            resendIntegrations:[{id:new ObjectId('000000000000000000000003'),label:'Fictional',permission:'full_access'}],
            trelloIntegrations:[{id:new ObjectId('000000000000000000000004'),label:'Fictional',username:'fictional',access:{memberAllowList:['*']}}]
          }}, {upsert:true})
        await c.close()`

        execFileSync('bun', ['-e', seed, stack.mongoUri, stack.teamId], {
          cwd: new URL('../../apps/backend', import.meta.url),
        })
        const as = client(stack.apiUrl, stack.token)
        const { tool } = mcp(as)
        const options = await as('GET', `/agent/credential-options?teamId=${stack.teamId}`)
        const available = options.body as AgentCredentialOptions

        must(
          available.resendIntegrations.length === 1 && available.trelloIntegrations.length === 1,
          'both opt-in integrations to be available',
        )
        const selection = defaultCredentialAccess(available)

        console.log('Before first turn, app picker defaults:', JSON.stringify(selection))
        const app = randomUUID()
        const sent = await as('POST', '/agent/chat', {
          id: app,
          teamId: stack.teamId,
          credentialAccess: selection,
          messages: [
            {
              id: randomUUID(),
              role: 'user',
              parts: [{ type: 'text', text: 'E2E_DELIVERY:app-creds' }],
            },
          ],
        })

        must(sent.status === 200, `app Task to start, got ${sent.text}`)
        await until('app Task to answer', async () => {
          const result = await tool<{ answer?: string }>('nuphos_check', { session_id: app })

          return result.structuredContent?.answer?.includes('ACK E2E_DELIVERY:app-creds')
        })
        const task = await askOverMcp(tool, stack.teamId, 'E2E_DELIVERY:mcp-creds')
        const access = async (id: string) => {
          const view = await as('GET', `/agent/conversations/${id}?teamId=${stack.teamId}`)

          return (view.body as { credentialAccess: Record<string, string[]> }).credentialAccess
        }
        const fromApp = await access(app)
        const fromMcp = await access(task)

        console.log('After first turn, MCP Task picker selection:', JSON.stringify(fromMcp))
        for (const key of [
          'awsRoleIds',
          'githubInstallationIds',
          'grafanaInstanceIds',
          'resendIntegrationIds',
          'trelloIntegrationIds',
        ]) {
          must(
            JSON.stringify(fromMcp[key]) === JSON.stringify(fromApp[key]),
            `${key} to match the app`,
          )
        }
        must(fromMcp.githubInstallationIds?.includes('123456'), 'GitHub to be selected')
        must(
          fromMcp.grafanaInstanceIds?.includes('000000000000000000000002'),
          'Grafana to be selected',
        )
        must(
          fromMcp.resendIntegrationIds?.length === 0 && fromMcp.trelloIntegrationIds?.length === 0,
          'Resend and Trello to stay off',
        )
      } finally {
        const restore = `
          import { MongoClient, ObjectId } from 'mongodb'
        import { EJSON } from 'bson'
          const c = await new MongoClient(process.argv[1]).connect()
          const collection = c.db('nuphos_e2e').collection('team_byos_bindings')
          const id = new ObjectId(process.argv[2])
          const row = EJSON.parse(await Bun.stdin.text())
          if (row) await collection.replaceOne({_id:id}, row, {upsert:true})
          else await collection.deleteOne({_id:id})
          await c.close()`

        execFileSync('bun', ['-e', restore, stack.mongoUri, stack.teamId], {
          cwd: new URL('../../apps/backend', import.meta.url),
          input: original,
        })
      }
    },
  },
]
