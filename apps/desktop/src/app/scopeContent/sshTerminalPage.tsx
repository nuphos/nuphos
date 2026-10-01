import { Terminal } from 'lucide-react'

import { SshTerminalView } from '../../components/SshTerminalView'

import type { ScopeRenderContext } from './context'

export function renderSshTerminalPage(ctx: ScopeRenderContext): React.ReactNode | undefined {
  const { sshTerminal, renderPage } = ctx

  if (sshTerminal) {
    const endpoint =
      sshTerminal.username && sshTerminal.publicIp
        ? `${sshTerminal.username}@${sshTerminal.publicIp} (${sshTerminal.region})`
        : sshTerminal.region

    return renderPage(
      'ssh',
      `SSH ${sshTerminal.instanceName}`,
      <Terminal className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <SshTerminalView
        sessionId={sshTerminal.sessionId}
        title={`SSH ${sshTerminal.instanceName}`}
        subtitle={endpoint}
        status={sshTerminal.status}
        error={sshTerminal.error}
      />,
    )
  }

  return undefined
}
