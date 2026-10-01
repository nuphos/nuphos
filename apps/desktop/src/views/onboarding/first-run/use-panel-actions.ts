import { useCallback } from 'react'

import { api } from '../../../api'
import { toast } from '../../../components/ui/toast'
import { track } from '../../../lib/analytics'
import { ARN_PATTERN, AZURE_GUID_PATTERN, SA_PATTERN } from '../../../lib/cloudBindSteps'
import { firstRunVocabulary } from '../../../lib/firstRunConnect'

import { clearProgress, setupTitles, writeProgress } from './progress'

import type { Purpose, Stage } from './progress'
import type { FirstRunProvider } from '../../../lib/firstRunConnect'
import type { Dispatch, RefObject, SetStateAction } from 'react'

export function useFirstRunPanelActions({
  stage,
  setStage,
  advancing,
  setAdvancing,
  advanceTimerRef,
  setupStep,
  setSetupStep,
  teamId,
  onClose,
  onBound,
  clearInputs,
  roleArn,
  saEmail,
  projectId,
  azureLabel,
  azureTenantId,
  azureClientId,
  azureSubscriptionId,
  setSubmitting,
}: {
  stage: Stage
  setStage: Dispatch<SetStateAction<Stage>>
  advancing: boolean
  setAdvancing: Dispatch<SetStateAction<boolean>>
  advanceTimerRef: RefObject<number | null>
  setupStep: number
  setSetupStep: Dispatch<SetStateAction<number>>
  teamId: string
  onClose: () => void
  onBound: () => void
  clearInputs: () => void
  roleArn: string
  saEmail: string
  projectId: string
  azureLabel: string
  azureTenantId: string
  azureClientId: string
  azureSubscriptionId: string
  setSubmitting: Dispatch<SetStateAction<boolean>>
}) {
  const close = useCallback(() => {
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current)
      advanceTimerRef.current = null
    }
    setAdvancing(false)
    setStage({ kind: 'pick', provider: null })
    clearInputs()
    onClose()
  }, [advanceTimerRef, setAdvancing, setStage, clearInputs, onClose])

  const persistStep = useCallback(
    (provider: FirstRunProvider, purpose: Purpose, step: number) => {
      setSetupStep(step)
      writeProgress(teamId, provider, purpose, step)
    },
    [teamId, setSetupStep],
  )

  const setupTotal = stage.kind === 'setup' ? setupTitles(stage.provider, stage.purpose).length : 0

  const advanceSetup = useCallback(() => {
    if (stage.kind !== 'setup' || advancing || setupStep >= setupTotal - 1) return
    const { provider, purpose } = stage
    const next = setupStep + 1

    setAdvancing(true)
    // Acknowledge the user's action before replacing it. This is the feedback
    // loop — not a claim that Nuphos verified AWS, just confirmation that their
    // self-reported progress was recorded.
    advanceTimerRef.current = window.setTimeout(() => {
      persistStep(provider, purpose, next)
      setAdvancing(false)
      advanceTimerRef.current = null
    }, 400)
  }, [advancing, persistStep, setupStep, setupTotal, stage, setAdvancing, advanceTimerRef])

  const canSubmit = (() => {
    if (stage.kind !== 'setup') return false
    if (stage.provider === 'aws') return ARN_PATTERN.test(roleArn.trim())
    if (stage.provider === 'gcp')
      return SA_PATTERN.test(saEmail.trim()) && Boolean(projectId.trim())

    return (
      Boolean(azureLabel.trim()) &&
      AZURE_GUID_PATTERN.test(azureTenantId.trim()) &&
      AZURE_GUID_PATTERN.test(azureClientId.trim()) &&
      AZURE_GUID_PATTERN.test(azureSubscriptionId.trim())
    )
  })()

  async function submit() {
    if (stage.kind !== 'setup' || !canSubmit) return
    const { provider, purpose } = stage

    setSubmitting(true)
    try {
      if (provider === 'aws') {
        await api.atlasBindAwsAccount(teamId, roleArn.trim())
      } else if (provider === 'gcp') {
        const bound = await api.atlasBindGcpProject(teamId, saEmail.trim(), projectId.trim())

        // The bind succeeded; an error toast is the only one that waits to be
        // dismissed, which a "grant one more role" instruction needs.
        for (const warning of bound?.warnings ?? []) {
          toast.error('GCP project bound with a gap', warning)
        }
      } else {
        await api.atlasBindAzureAccount(
          teamId,
          azureLabel.trim(),
          azureTenantId.trim(),
          azureClientId.trim(),
          azureSubscriptionId.trim(),
        )
      }
    } catch (e) {
      toast.apiError(`Could not connect ${firstRunVocabulary(provider).label}`, e, {
        fallback: 'Check the details and your connection, then try again.',
      })
      setSubmitting(false)

      return
    }
    setSubmitting(false)
    onBound()
    clearProgress(teamId, provider, purpose)
    setSetupStep(0)
    clearInputs()
    track('agent_first_run_operational_bound', { provider })
    setStage({ kind: 'connected', provider })
  }

  return { close, persistStep, setupTotal, advanceSetup, canSubmit, submit }
}
