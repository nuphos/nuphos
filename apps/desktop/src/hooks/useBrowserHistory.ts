import { useCallback, useMemo, useSyncExternalStore } from 'react'

import {
  browserHistoryKey,
  parseBrowserHistory,
  readBrowserHistorySnapshot,
  subscribeBrowserHistory,
} from '../lib/browserHistory'

export function useBrowserHistory(userId: string, teamId: string) {
  const key = browserHistoryKey(userId, teamId)
  const subscribe = useCallback(
    (listener: () => void) => subscribeBrowserHistory(key, listener),
    [key],
  )
  const getSnapshot = useCallback(() => readBrowserHistorySnapshot(key), [key])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => null)

  return useMemo(() => parseBrowserHistory(snapshot), [snapshot])
}
