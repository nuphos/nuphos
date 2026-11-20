import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { startStack } from './stack.ts'
import { startDesktop } from './desktop.ts'
import { signInScenarios } from './sign-in-scenarios.ts'
import { me } from './box-scenarios.ts'
import { artifacts, stopAll } from './processes.ts'
import { newTask, send } from './ui.ts'

let desktop
try {
  console.log('Artifacts:', artifacts)
  const stack = await startStack()
  const owner = await me(stack)
  const seed = `import {MongoClient} from 'mongodb'; const [uri,teamId,createdBy]=process.argv.slice(1); const c=await new MongoClient(uri).connect(); await c.db('nuphos_e2e').collection('plans').insertOne({teamId,createdBy,number:900,title:'E2E plan reference',steps:[],status:'proposed',approvals:[],createdAt:new Date(),updatedAt:new Date()}); await c.close()`
  execFileSync('bun', ['-e', seed, stack.mongoUri, stack.teamId, owner], {
    cwd: resolve(import.meta.dirname, '../../apps/backend'),
  })
  desktop = await startDesktop(stack.apiUrl)
  const page = desktop.page
  page.setDefaultTimeout(30000)
  await signInScenarios[1].run(page, stack)
  const before = readFileSync(join(artifacts, 'backend.log'), 'utf8').length
  await newTask(page)
  await send(page, 'Show the plan E2E_PLAN_REFERENCE E2E_WAIT_RELEASE E2E_DELIVERY:plan')
  await page.getByText('E2E plan reference').first().waitFor()
  await page.screenshot({ path: join(artifacts, 'plan-live.png') })
  await page.waitForTimeout(1800)
  const requests = readFileSync(join(artifacts, 'backend.log'), 'utf8').slice(before)
  if (requests.includes('\"path\":\"/agent/plans\"'))
    throw new Error('The chat polled the Plans list')
  writeFileSync(join(artifacts, 'release'), 'go')
  await page.getByText('ACK E2E_DELIVERY:plan').waitFor()
  await page.reload()
  await page.getByText('E2E plan reference').first().waitFor()
  await page.screenshot({ path: join(artifacts, 'plan-history.png') })
  console.log('PASS Plan card appears live and after reload (seeded legacy Plan and fixture agent)')
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await desktop?.close(true)
  await stopAll()
  if (desktop) rmSync(desktop.profile, { recursive: true, force: true })
}
