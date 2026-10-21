import type { StreamPurpose, TunnelClientDeps } from './tunnel-client.ts'

/** Local tools stay separate from an agent's transport and control connection. */
export function connectLocalStream(
  deps: TunnelClientDeps,
  purpose: Exclude<StreamPurpose, 'transport' | 'control' | 'instances'>,
  instanceId?: string,
) {
  const connectors = {
    terminal: deps.connectTerminal,
    file: deps.connectFile,
    attachments: deps.connectAttachments,
    exec: deps.connectExec,
    cua: deps.connectCua,
    browser: deps.connectBrowser,
    vnc: deps.connectVnc,
  }

  return connectors[purpose]?.(instanceId)
}
