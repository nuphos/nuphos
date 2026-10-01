import clsx from 'clsx'
import { Check, Terminal, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { useReportVisibleError } from '../../VisibleErrorReporter'

import { LoadingText } from './partChrome'
import { extractCommandOutput, getCommandFromInput, trimDisplayBlock } from './toolPartUtils'

import type { ToolPart } from './parts'

export function CommandTerminalView({ part }: { part: ToolPart }) {
  const command = trimDisplayBlock(getCommandFromInput(part.input) ?? '')
  const done = part.state === 'output-available' || part.state === 'output-error'
  const errored = part.state === 'output-error'
  const output = extractCommandOutput(done ? part.output : (part.liveOutput ?? part.output))
  const stdout = trimDisplayBlock(output.stdout)
  const stderr = trimDisplayBlock(output.stderr)
  const errorText = part.errorText ? trimDisplayBlock(part.errorText) : ''
  const { exitCode } = output
  const labelTool = part.toolName === 'local_exec' ? 'local' : 'bash'
  const failed = errored || (exitCode !== null && exitCode !== 0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!done && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [done, stdout, stderr])

  useReportVisibleError(
    failed
      ? errorText ||
          stderr ||
          `Agent command failed with exit code ${String(exitCode ?? 'unknown')}`
      : null,
    'agent_command_failure',
  )

  return (
    <div className="box-border w-full max-w-full overflow-hidden rounded-md border border-zGray-800/70 bg-zGray-950/60 font-mono text-[13px]">
      <div className="flex items-center gap-1.5 border-b border-zGray-800/40 px-3 py-1 text-[11px] uppercase tracking-wider text-tertiary">
        <Terminal className="w-3 h-3" strokeWidth={2} />
        <span>{labelTool}</span>
        <div className="flex-1" />
        {!done && <LoadingText>running</LoadingText>}
        {done && exitCode !== null && exitCode !== 0 && (
          <span className="normal-case text-error">exit {exitCode}</span>
        )}
        {done && !failed && <Check className="h-3 w-3 text-emerald-400" strokeWidth={2.5} />}
        {done && failed && <X className="h-3 w-3 text-error" strokeWidth={2.5} />}
      </div>
      <div
        ref={scrollRef}
        className="min-w-0 max-w-full max-h-72 overflow-auto scrollbar-thin px-3 py-2 leading-[1.55]"
      >
        <div className="whitespace-pre text-main">
          <span className="select-none text-emerald-400">$ </span>
          {command}
        </div>
        {stdout && <div className="mt-1 whitespace-pre text-secondary">{stdout}</div>}
        {stderr && (
          <div className={clsx('mt-1 whitespace-pre', failed ? 'text-error/90' : 'text-tertiary')}>
            {stderr}
          </div>
        )}
        {errorText && <div className="mt-1 whitespace-pre text-error/90">{errorText}</div>}
      </div>
    </div>
  )
}

export function CodeSection({ label, value }: { label: string; value: unknown }) {
  const text = trimDisplayBlock(typeof value === 'string' ? value : JSON.stringify(value, null, 2))

  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-tertiary mb-0.5">{label}</div>
      <pre className="text-[12px] font-mono text-secondary bg-zGray-950/60 rounded p-2 overflow-auto max-h-48 scrollbar-thin whitespace-pre-wrap break-words">
        {text}
      </pre>
    </div>
  )
}
