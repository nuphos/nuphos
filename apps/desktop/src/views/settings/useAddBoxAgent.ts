import { useState } from 'react'

import { api } from '../../api'
import { parseAtlasError } from '../../api/errors'

import type { LocalAgentProvider } from '../../api/device-types'

export type AddingAgent = { provider: LocalAgentProvider; error?: string }

/** Adding an agent takes the Box a few seconds: report it at once, and its failure in place. */
export function useAddBoxAgent(
  deviceId: string,
  teamId: string,
  onAdded: (runtimeId: string) => void,
) {
  const [adding, setAdding] = useState<AddingAgent | null>(null)
  const add = (provider: LocalAgentProvider) => {
    setAdding({ provider })
    api.boxCreateAgent(deviceId, teamId, provider).then(
      ({ runtimeId }) => {
        setAdding(null)
        onAdded(runtimeId)
      },
      (error: unknown) => setAdding({ provider, error: parseAtlasError(error).message }),
    )
  }

  return { adding, pending: adding !== null && !adding.error, add }
}
