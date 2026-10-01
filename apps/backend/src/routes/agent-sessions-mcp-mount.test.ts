import { describe, expect, test } from 'bun:test'

describe('agent-sessions runtime mounts', () => {
  test('MCP and native-skill APIs sit under the team-scoped member gate', async () => {
    const source = await Bun.file(new URL('./agent-sessions.ts', import.meta.url)).text()
    const servers = await Bun.file(
      new URL('../lib/claude-code-preview/credentials-mcp.ts', import.meta.url),
    ).text()

    expect(source).toContain("teamScoped.post('/mcp', ")
    expect(source).toContain("teamScoped.post('/mcp-tools', ")
    expect(source).toContain("teamScoped.get('/mcp-tools', sseUnsupported)")
    expect(source).toContain("teamScoped.route('/plans', previewPlans)")
    expect(source.indexOf("teamScoped.use('*', requireTeamMember())")).toBeLessThan(
      source.indexOf("teamScoped.post('/mcp-tools'"),
    )
    expect(source.indexOf("teamScoped.use('*', requireTeamMember())")).toBeLessThan(
      source.indexOf("teamScoped.route('/plans'"),
    )
    expect(servers).toContain("name: 'nuphos-tools', type: 'http', url: `${mount}/mcp-tools`")
  })
})
