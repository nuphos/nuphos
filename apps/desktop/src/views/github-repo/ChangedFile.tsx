import { Collapsible } from '@base-ui/react/collapsible'
import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'

import { FileStatusIcon } from './FileStatusIcon'
import { changedFileAnchor } from './fileTree'

import type { GithubPRFile } from '../../types'

export function DiffLine({ line }: { line: string }) {
  let kind: 'hunk' | 'add' | 'del' | 'plain' = 'plain'

  if (line.startsWith('@@')) kind = 'hunk'
  else if (line.startsWith('+')) kind = 'add'
  else if (line.startsWith('-')) kind = 'del'

  return (
    <div
      className={clsx(
        'min-w-max whitespace-pre px-3 font-mono text-[11.5px] leading-5 [tab-size:4]',
        kind === 'hunk' && 'bg-action-primary/[0.07] text-primary',
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
    <Collapsible.Root
      defaultOpen
      id={changedFileAnchor(file.filename)}
      className="scroll-mt-3 overflow-hidden rounded-lg border border-line-control/80 bg-state-selected"
    >
      <Collapsible.Trigger className="group flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left outline-none transition-colors hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-line-focus">
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 text-tertiary transition-transform group-data-[panel-open]:rotate-90"
          strokeWidth={2}
        />
        <FileStatusIcon status={file.status} />
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
      </Collapsible.Trigger>
      <Collapsible.Panel className="t-acc-collapsible border-t border-line-control/70">
        {file.previousFilename && (
          <div className="border-b border-line-control/60 px-3 py-1.5 text-[11px] text-tertiary">
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
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
