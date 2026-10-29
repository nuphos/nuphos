import { TriangleAlert, X } from 'lucide-react'

import { resourceMark } from './sessionResourcePresentation'

import type { SessionResource } from '../../api/session-resource-types'

const markGlyphs = {
  cross: <X className="size-3 shrink-0" strokeWidth={3} />,
  dot: (
    <svg viewBox="0 0 14 14" className="size-3 shrink-0">
      <circle cx="7" cy="7" r="3.5" fill="currentColor" />
    </svg>
  ),
  conflict: <TriangleAlert className="size-3 shrink-0" strokeWidth={2.25} />,
}

/** An open PR's checks, review or conflict mark, beside its tag; nothing when nothing holds it up. */
export function ResourceMark({ resource }: { resource: SessionResource }) {
  const mark = resourceMark(resource)

  return mark ? (
    <span aria-hidden className={`inline-flex shrink-0 ${mark.color}`}>
      {markGlyphs[mark.glyph]}
    </span>
  ) : null
}
