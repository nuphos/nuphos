const now = new Date().toISOString()
const devices = [
  { deviceId: 'd1', label: 'Box 1', platform: 'linux', online: true, access: 'manage', createdAt: now, lastSeenAt: now,
    box: { provider: 'instabox', sandboxId: 's1', state: 'running' } },
  { deviceId: 'd2', label: 'Studio Mac', platform: 'darwin', model: 'MacBook Pro', online: true, access: 'manage', createdAt: now, lastSeenAt: now },
]
const instances = [
  { id: 'r1', label: 'Claude Code', provider: 'claude-code', kind: 'local', status: 'active', createdAt: now, local: { ownerUserId: 'u1', deviceLabel: 'Box 1', online: true, deviceId: 'd1', signedIn: true, agentInstances: true } },
  { id: 'r2', label: 'Codex', provider: 'codex', kind: 'local', status: 'active', createdAt: now, local: { ownerUserId: 'u1', deviceLabel: 'Studio Mac', online: true, deviceId: 'd2', signedIn: true, agentInstances: true } },
]
const known: Record<string, unknown> = {
  boxListDevices: { devices, boxAvailable: true },
  atlasListRuntimeInstances: instances,
  atlasListRuntimeQuotas: [],
  boxUsage: { limitVcpus: 8, subscribed: true, usedVcpus: 2, boxVcpus: 2, sizes: [{ vcpus: 2, memMiB: 4096 }, { vcpus: 4, memMiB: 8192 }], boxes: [], billingUrl: null },
  localRuntimeGetState: null,
  boxJoinToken: { token: 'nj_3f9c1a7e5b2d4c8a', expiresAt: now, apiUrl: 'https://api.nuphos.ai' },
}
const joined: string[] = []
const listeners = new Set<(id: string, text: string) => void>()
const BRIDGE = 'http://localhost:5399'
const custom: Record<string, (...args: never[]) => unknown> = {
  sshHosts: () => fetch(`${BRIDGE}/hosts`).then((r) => r.json()),
  onSshJoinOutput: (cb: (id: string, text: string) => void) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  sshJoinCancel: () => Promise.resolve(),
  boxListDevices: () =>
    Promise.resolve({
      boxAvailable: true,
      devices: [
        ...structuredClone(devices),
        ...joined.map((label) => ({ deviceId: `j-${label}`, label, platform: 'linux', online: true, access: 'manage' })),
      ],
    }),
  sshJoin: async (id: string, target: string) => {
    const res = await fetch(`${BRIDGE}/join?target=${encodeURIComponent(target)}`)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let all = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value)
      all += text
      const visible = text.split('\n@@')[0]
      if (visible) for (const l of listeners) l(id, visible)
    }
    const result = JSON.parse(all.split('\n@@').pop()!)
    if (result.ok) setTimeout(() => joined.push(target), 2500)
    return result
  },
}
;(window as unknown as { api: unknown }).api = new Proxy({}, {
  get: (_, key: string) => {
    if (key in custom) return custom[key]
    if (key.startsWith('on')) return () => () => {}
    if (key in known) return () => Promise.resolve(structuredClone(known[key]))
    if (/^(get|is)/.test(key)) return () => undefined
    return () => { console.log('stub', key); return Promise.resolve([]) }
  },
})
localStorage.setItem('atlas.theme', 'light')

const { createRoot } = await import('react-dom/client')
const { useState } = await import('react')
await import('../index.css')
await import('../styles/transitions-root.css')
await import('../styles/transitions.css')
const { ThemeProvider } = await import('../hooks/ThemeProvider')
const { ToastProvider } = await import('../components/ui/ToastProvider')
const { ToolbarPrimaryActionContext } = await import('../hooks/useToolbarPrimaryAction')
const { Button } = await import('../components/ui/button')
const { WorkspaceTabContext } = await import('../hooks/useWorkspaceTab')
const { AgentSection } = await import('../views/settings/AgentSection')

function Page() {
  const [action, setAction] = useState<{ label: string; onClick: () => void } | null>(null)
  return (
    <WorkspaceTabContext.Provider value={{ tabId: 't', refreshKey: 0, pollTick: 0, isActive: true }}><ToolbarPrimaryActionContext.Provider value={setAction}>
      <div className="flex h-screen flex-col bg-main text-main">
        <div className="flex h-[42px] items-center justify-between border-b border-zGray-800/60 px-4">
          <span className="text-[13px] font-medium">Runtimes</span>
          {action && <Button size="sm" onClick={action.onClick}>{action.label}</Button>}
        </div>
        <AgentSection teamId="t1" isAdmin filter="" refreshKey={0} onCount={() => {}} onLoading={() => {}} />
      </div>
    </ToolbarPrimaryActionContext.Provider></WorkspaceTabContext.Provider>
  )
}
createRoot(document.getElementById('root')!).render(<ThemeProvider><ToastProvider><Page /></ToastProvider></ThemeProvider>)
