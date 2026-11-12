import { clsx } from 'clsx'
import { useMemo } from 'react'

import {
  FILE_PREVIEW_FRAME_NAME,
  FILE_PREVIEW_SANDBOX,
  filePreviewSrcDoc,
} from './filePreviewSandbox'

/** An HTML file, drawn but never run: see filePreviewSandbox. Pages are drawn on white. */
export function FilePreviewFrame({
  html,
  title,
  className,
}: {
  html: string
  title: string
  className?: string
}) {
  const srcDoc = useMemo(() => filePreviewSrcDoc(html), [html])

  return (
    <iframe
      name={FILE_PREVIEW_FRAME_NAME}
      title={title}
      srcDoc={srcDoc}
      sandbox={FILE_PREVIEW_SANDBOX}
      referrerPolicy="no-referrer"
      className={clsx('block border-0 bg-white [color-scheme:light]', className)}
    />
  )
}
