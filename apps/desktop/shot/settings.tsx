import { GeneralSection } from '../src/views/settings/GeneralSection'
import { LocalRuntimeSection } from '../src/views/settings/LocalRuntimeSection'
import { BoxSection } from '../src/views/settings/BoxSection'
import { WorkspaceTabContext } from '../src/hooks/useWorkspaceTab'
export function render(view: string, team: any, _members: any) {
  if (view === 'general') return <GeneralSection team={team} userEmail="demo@example.com" onTeamUpdated={() => {}} onTeamRemoved={() => {}} />
  if (view === 'computers') {
    const rt = (provider: string, label: string) => ({ id: `local_u-me_demo-mac_${provider}`, kind: 'local', provider, label, status: 'active',
      local: { ownerUserId: 'u-me', deviceId: 'demo-mac', deviceLabel: 'Demo MacBook Pro', signedIn: true, online: true } })
    return <WorkspaceTabContext.Provider value={{ tabId: 'shot', refreshKey: 0, pollTick: 0, isActive: true }}><div style={{ width: 860 }}><BoxSection teamId="t-demo" instances={[rt('claude-code', 'Claude Code'), rt('codex', 'Codex')] as any} onSelect={() => {}} canCreate /></div></WorkspaceTabContext.Provider>
  }
  return <LocalRuntimeSection currentTeamId="t-demo" currentUserId="u-me" />
}
