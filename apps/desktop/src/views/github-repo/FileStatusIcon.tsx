import clsx from 'clsx'
import { FileDiff, FileMinus, FilePen, FilePlus } from 'lucide-react'

export function FileStatusIcon({ status }: { status: string }) {
  let Icon = FileDiff
  let tone = 'text-tertiary'

  if (status === 'added') {
    Icon = FilePlus
    tone = 'text-success'
  } else if (status === 'removed') {
    Icon = FileMinus
    tone = 'text-error'
  } else if (status === 'renamed') {
    Icon = FilePen
    tone = 'text-zViolet-accent'
  }

  return <Icon className={clsx('h-3.5 w-3.5 shrink-0', tone)} strokeWidth={1.8} />
}
