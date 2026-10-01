import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

export type DevCommandResult = {
  exitCode: number
  timedOut: boolean
}

export type DevCommandOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  onStdout?: (line: string) => void
  onStderr?: (line: string) => void
}

export function runDevCommand(
  command: string,
  args: string[],
  options: DevCommandOptions,
): Promise<DevCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let timedOut = false
    let settled = false

    const stdout = createInterface({ input: child.stdout })
    const stderr = createInterface({ input: child.stderr })

    stdout.on('line', (line) => options.onStdout?.(line))
    stderr.on('line', (line) => options.onStderr?.(line))

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 1_000).unref()
    }, options.timeoutMs ?? 30_000)

    const finish = (exitCode: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stdout.close()
      stderr.close()
      resolve({ exitCode: timedOut ? 124 : exitCode, timedOut })
    }

    child.once('error', () => finish(1))
    child.once('close', (code) => finish(code ?? 1))
  })
}
