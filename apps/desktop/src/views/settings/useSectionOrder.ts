import { useState } from 'react'

import { useCurrentUser } from '../../hooks/useCurrentUser'

import {
  readSectionOrder,
  sectionOrderStorageKey,
  writeSectionOrder,
} from './sectionOrderPresentation'

import type { OrderStorage } from './sectionOrderPresentation'

function browserStorage(): OrderStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/**
 * A page's section order, kept per person and team on this computer. Until the
 * person is known there is nowhere to save it, so the page is not reorderable yet.
 */
export function useSectionOrder<T extends string>(teamId: string, defaults: readonly T[]) {
  const userId = useCurrentUser()?.id
  const key = userId ? sectionOrderStorageKey(userId, teamId) : null
  const read = () => (key ? readSectionOrder(browserStorage(), key, defaults) : [...defaults])
  const [state, setState] = useState(() => ({ key, order: read() }))

  // Another person or team on the same mounted page reads its own saved order.
  if (state.key !== key) setState({ key, order: read() })

  const save = (order: T[]) => {
    if (!key) return
    setState({ key, order })
    writeSectionOrder(browserStorage(), key, order, defaults)
  }

  return {
    order: state.order,
    editable: key !== null,
    isDefault: state.order.join() === defaults.join(),
    onChange: save,
    onReset: () => save([...defaults]),
  }
}
