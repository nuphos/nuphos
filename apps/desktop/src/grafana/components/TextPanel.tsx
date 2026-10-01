import { MessageResponse } from '../../components/agent/MessageResponse'

import type { ReactNode } from 'react'

type Props = {
  options?: Record<string, unknown>
}

// Grafana "text" panel, rendered with the app's markdown renderer. Html mode
// is left unrendered (raw tags show as text) on purpose.
export function TextPanel({ options }: Props) {
  const content = typeof options?.content === 'string' ? options.content : ''

  return (
    <div className="absolute inset-0 overflow-auto scrollbar-thin px-3 py-2 text-secondary">
      <MessageResponse className="text-[12px]" streaming={false} renderLink={renderSafeLink}>
        {content}
      </MessageResponse>
    </div>
  )
}

// The main window forwards every _blank navigation to shell.openExternal, so a
// dashboard note must not be able to smuggle javascript:/file:/custom schemes.
function renderSafeLink(href: string, children: ReactNode): ReactNode | null {
  return /^(https?:|mailto:)/i.test(href) ? null : <>{children}</>
}
