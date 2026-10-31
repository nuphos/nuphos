import { useEffect, useState } from 'react'

import { api } from '../api'

/** The version of an update that finished downloading in the background, or
 * null. It only ever goes from null to a version, so the snapshot and the live
 * event cannot race each other. */
export function useReadyUpdate(): string | null {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    const off = api.onUpdaterReady(setVersion)

    api
      .updaterGetReadyVersion()
      .then((ready) => setVersion((current) => current ?? ready))
      .catch(() => null)

    return off
  }, [])

  return version
}
