import { antigravityStatus } from './antigravity-status.mjs'

process.stdout.write(
  `${JSON.stringify(await antigravityStatus(process.env.NUPHOS_AGENT_EXECUTABLE))}\n`,
)
