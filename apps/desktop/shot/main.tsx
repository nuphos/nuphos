import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { ToastProvider } from '../src/components/ui/ToastProvider'
import { ThemeProvider } from '../src/hooks/ThemeProvider'
import { ConfirmDialog } from '../src/components/ConfirmDialog'
import * as sharing from '../src/lib/localAgentSharing'
import * as settings from './settings'

localStorage.setItem('atlas.theme', 'light')
const params = new URLSearchParams(location.search)
const view = params.get('view') ?? 'local'
const ceiling = (params.get('ceiling') ?? 'approve') as 'off' | 'approve' | 'full'
const level = (params.get('level') ?? 'approve') as 'off' | 'approve' | 'full'
const admin = params.get('admin') !== '0'

const member = (id: string, name: string, role = 'MEMBER') => ({
  id, name, email: `${name.split(' ')[0].toLowerCase()}@example.com`, username: name.split(' ')[0].toLowerCase(), role, joinedAt: '2026-01-01T00:00:00Z',
})
const members = [member('u-me', 'Demo User', 'ADMINISTRATOR'), member('u-alex', 'Alex Chen'), member('u-sam', 'Sam Rivera'), member('u-jordan', 'Jordan Lee')]
const team = { id: 't-demo', name: 'Acme Demo', role: admin ? 'ADMINISTRATOR' : 'MEMBER', isOwner: admin, ownerID: 'u-me', localAgentSharing: ceiling, allowedEmailDomains: [], contactEmails: [] }
const cli = { installed: true, path: '/usr/local/bin/claude', version: '2.3.1', loggedIn: true, account: 'demo@example.com', plan: 'Pro' }
const state = {
  agents: {
    'claude-code': { available: true, online: true, cli },
    codex: { available: true, online: true, cli: { ...cli, path: '/usr/local/bin/codex', version: '0.48.0', plan: 'Plus' } },
  },
  workspace: '/Users/demo/Nuphos', userId: 'u-me', deviceId: 'demo-mac',
}
const fixtures: Record<string, unknown> = {
  localRuntimeGetState: state, localRuntimeRefresh: state,
  localRuntimeListActivity: { entries: [], nextCursor: null },
  deviceGetIdentity: { deviceId: 'demo-mac', label: 'Demo MacBook Pro', platform: 'darwin' },
  localShareGet: { share: { level, everyone: false, userIds: level === 'off' ? [] : ['u-alex', 'u-sam'] }, ceiling },
  localShareApprovals: level === 'off' ? [] : [
    { id: 'ap1', deviceId: 'demo-mac', deviceLabel: 'Demo MacBook Pro', sessionId: 's1', actorId: 'u-alex', requestedAt: '2026-10-23T08:00:00Z' },
  ],
  atlasListTeamMembers: members,
  boxListDevices: {
    boxAvailable: true,
    devices: [
      { deviceId: 'demo-mac', label: 'Demo MacBook Pro', platform: 'darwin', model: 'MacBook Pro', online: true, access: 'manage', allowLocalExec: true,
        metricsStatus: 'live', metricsReceivedAt: new Date().toISOString(),
        metrics: { sampledAt: new Date().toISOString(), cpuPercent: 18, memory: { used: 9.6e9, total: 32e9 }, disk: { used: 412e9, total: 1e12 } } },
      { deviceId: 'demo-linux', label: 'Demo Workstation', platform: 'linux', online: false, access: 'manage', allowLocalExec: false, metricsStatus: 'offline', metrics: null },
    ],
  },
  boxUsage: { limitVcpus: null, subscribed: false, usedVcpus: 0, boxVcpus: 2 },
}
;(window as any).api = new Proxy({}, {
  get: (_t, key: string) => {
    if (key.startsWith('on')) return () => () => {}
    return () => (key in fixtures ? Promise.resolve(fixtures[key]) : new Promise(() => {}))
  },
})

const local = (shared?: 'approve' | 'full') => ({
  id: 'local_u_dev_claude-code', kind: 'local', provider: 'claude-code', label: shared ? 'Alex’s MacBook Pro (shared)' : 'Demo MacBook Pro', status: 'active',
  local: { ownerUserId: shared ? 'u-alex' : 'u-me', deviceId: 'mac', deviceLabel: 'MacBook Pro', signedIn: true, ...(shared ? { shared: { level: shared } } : {}) },
})

function App() {
  if (view === 'move') {
    const shared = (params.get('shared') ?? '') as '' | 'approve' | 'full'
    const target = local(shared || undefined) as any
    return <ConfirmDialog open title={`Move to ${target.label}?`} description={sharing.localAgentMoveWarning(target) ?? ''} confirmLabel="Move" onConfirm={() => {}} onClose={() => {}} />
  }
  return <div style={{ width: 924, padding: 32 }} className="bg-app">{settings.render(view, team, members)}</div>
}
createRoot(document.getElementById('root')!).render(<ThemeProvider><ToastProvider><App /></ToastProvider></ThemeProvider>)
