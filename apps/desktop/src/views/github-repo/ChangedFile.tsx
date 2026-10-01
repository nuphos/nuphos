import clsx from 'clsx'
import { FileDiff } from 'lucide-react'

import type { GithubPRFile } from '../../types'

export function DiffLine({ line }: { line: string }) {
  let kind: 'hunk' | 'add' | 'del' | 'plain' = 'plain'

  if (line.startsWith('@@')) kind = 'hunk'
  else if (line.startsWith('+')) kind = 'add'
  else if (line.startsWith('-')) kind = 'del'

  return (
    <div
      className={clsx(
        'min-w-max px-3 font-mono text-[11.5px] leading-5',
        kind === 'hunk' && 'bg-zViolet-accent/[0.07] text-zViolet-accent',
        kind === 'add' && 'bg-success/[0.07] text-success',
        kind === 'del' && 'bg-error/[0.07] text-error',
        kind === 'plain' && 'text-secondary',
      )}
    >
      {line || ' '}
    </div>
  )
}

export function ChangedFile({ file }: { file: GithubPRFile }) {
  return (
    <section className="overflow-hidden rounded-lg border border-zGray-800/80 bg-zGray-900/50">
      <div className="flex min-h-10 items-center gap-2 border-b border-zGray-800/70 px-3 py-2">
        <FileDiff className="h-3.5 w-3.5 shrink-0 text-tertiary" strokeWidth={1.8} />
        <span
          className="min-w-0 flex-1 truncate font-mono text-[12px] text-main"
          title={file.filename}
        >
          {file.filename}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-[11px] font-medium text-success">+{file.additions}</span>
          <span className="text-[11px] font-medium text-error">−{file.deletions}</span>
        </span>
      </div>
      {file.previousFilename && (
        <div className="border-b border-zGray-800/60 px-3 py-1.5 text-[11px] text-tertiary">
          renamed from <span className="break-all font-mono">{file.previousFilename}</span>
        </div>
      )}
      {file.patch ? (
        <div className="overflow-x-auto py-1 scrollbar-thin">
          {file.patch.split('\n').map((line, index) => (
            <DiffLine key={`${String(index)}:${line}`} line={line} />
          ))}
        </div>
      ) : (
        <div className="px-3 py-6 text-center text-[12px] text-tertiary">
          Diff unavailable (binary or too large)
        </div>
      )}
    </section>
  )
}
