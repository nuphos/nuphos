// The instabox connection shared by the Box provider: the deployment's key,
// bounded timeouts, and the commands a fresh machine runs.

import { InstaboxError } from '@insforge/instabox-sdk'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { killMachine, listMachines } from './instabox-machines'

/** The default template: a desktop the person can watch and take over. */
export const BOX_TEMPLATE = 'agent-browser'
/** Installing the CLI and the agents on a fresh machine. */
export const INSTALL_TIMEOUT_MS = 9 * 60_000
/** Ordering a machine, in the background. */
export const CREATE_TIMEOUT_MS = 3 * 60_000
/** Anything on a turn's path: an instabox outage must not stall a conversation for long. */
export const QUICK_TIMEOUT_MS = 30_000

/** Node 22 and the agents, then the CLI; idempotent, so a resume can run it again. */
export const BOX_INSTALL_COMMAND = [
  'set -e',
  'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"',
  'if ! node -e "process.exit(+process.versions.node.split(\'.\')[0] >= 22 ? 0 : 1)" 2>/dev/null; then',
  '  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs',
  'fi',
  'command -v claude >/dev/null && command -v codex >/dev/null || { npm config set prefix "$HOME/.npm-global" && npm i -g @anthropic-ai/claude-code @openai/codex; }',
  'command -v nuphos >/dev/null || curl -fsSL https://nuphos.ai/install | sh',
  // So `nuphos` also works in the Box\'s own terminal, not only in the commands run here.
  'grep -q .local/bin "$HOME/.profile" 2>/dev/null || echo \'export PATH="$HOME/.local/bin:$PATH"\' >> "$HOME/.profile"',
].join('\n')

/**
 * Starts the host, which keeps the Box's own credential. Run with `background: true`:
 * a foreground run would wait for the host, which never exits on its own.
 */
export const AGENT_COMMAND = `export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"; pgrep -f "[h]ost.mjs" >/dev/null || exec setsid nuphos agent >> "$HOME/nuphos-agent.log" 2>&1 < /dev/null`

export function connection(timeoutMs: number) {
  const box = config.box.instabox

  if (!box) throw new AppError(503, 'box_unavailable', 'Boxes are not enabled on this deployment')

  return { ...box, requestTimeoutMs: timeoutMs, operationTimeoutMs: timeoutMs }
}

export function boxesEnabled(): boolean {
  return config.box.instabox !== null
}

/** Where a Box dials this backend from the internet: its public backend URL, else the deployment's. */
export function boxBackendUrl(): string | undefined {
  const url = config.agent.publicBackendUrl ?? config.auth.publicBaseUrl

  return /^https?:\/\/localhost(?::\d+)?$/u.test(url) ? undefined : url
}

export function boxesAvailable(): boolean {
  return boxesEnabled() && boxBackendUrl() !== undefined
}

export const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))
export const unavailable = (what: string, error: unknown) =>
  new AppError(503, 'box_unavailable', `${what}: ${reason(error)}`)

/**
 * Deletes the machine a Box owns. A row that never got its machine id (the backend
 * went away between ordering the machine and recording it) may still own one: it is
 * found by the device id in its metadata. A failed kill throws, so the caller keeps
 * the row and nothing is orphaned silently.
 */
export async function killBoxMachine(
  conn: ReturnType<typeof connection>,
  sandboxId: string | undefined,
  deviceId: string,
): Promise<void> {
  const machines = sandboxId ? [{ sandboxId }] : await listMachines(conn, { deviceId })

  for (const machine of machines) await kill(machine.sandboxId, conn)
}

/** Deletes a machine, treating one that is already gone as deleted. */
export async function kill(
  sandboxId: string,
  conn: ReturnType<typeof connection> = connection(QUICK_TIMEOUT_MS),
): Promise<void> {
  try {
    await killMachine(conn, sandboxId)
  } catch (error) {
    if (error instanceof InstaboxError && error.status === 404) return
    throw error
  }
}
