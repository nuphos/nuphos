import { startStack } from './stack.ts'
import { stopAll } from './processes.ts'
import { mcpCredentialDefaultsScenarios } from './mcp-credential-defaults-scenarios.ts'
try {
  const stack = await startStack()
  await mcpCredentialDefaultsScenarios[0].run(null as never, stack)
  console.log('MCP and app Task credential defaults match')
} finally {
  await stopAll()
}
