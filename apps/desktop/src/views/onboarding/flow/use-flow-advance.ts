import { useCallback, useEffect, useRef, useState } from 'react'

import type { ChatStep, OnboardingProvider, SlackOutcome } from './shared'
import type { Dispatch, RefObject, SetStateAction } from 'react'

export function useOnboardingTimers(): {
  bindDialogTimerRef: RefObject<number | null>
  demoAdvanceTimerRef: RefObject<number | null>
} {
  // Deferred open of the Slack bind dialog (see handleConnectSlack). Tracked so
  // it can be cleared on unmount and never fires setState on an unmounted
  // component.
  const bindDialogTimerRef = useRef<number | null>(null)
  // Deferred advance from the simulated cloud-bind demo to the Slack step (see
  // handleBindingDone). Same cleanup discipline.
  const demoAdvanceTimerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (bindDialogTimerRef.current !== null) {
        window.clearTimeout(bindDialogTimerRef.current)
      }
      if (demoAdvanceTimerRef.current !== null) {
        window.clearTimeout(demoAdvanceTimerRef.current)
      }
    },
    [],
  )

  return { bindDialogTimerRef, demoAdvanceTimerRef }
}

export function useFlowAdvance({
  joinedExisting,
  onFinish,
  teamId,
  currentTeamId,
  setTeamId,
  setChatStep,
  setSelectedProvider,
  setSlackBinding,
  setSlackDialogOpen,
  bindDialogTimerRef,
  demoAdvanceTimerRef,
}: {
  joinedExisting: boolean
  onFinish: (teamId: string | null) => void
  teamId: string | null
  currentTeamId: string | null
  setTeamId: Dispatch<SetStateAction<string | null>>
  setChatStep: Dispatch<SetStateAction<ChatStep>>
  setSelectedProvider: Dispatch<SetStateAction<OnboardingProvider | null>>
  setSlackBinding: Dispatch<SetStateAction<boolean>>
  setSlackDialogOpen: Dispatch<SetStateAction<boolean>>
  bindDialogTimerRef: RefObject<number | null>
  demoAdvanceTimerRef: RefObject<number | null>
}) {
  // The user acknowledged the security briefing. Workspace creators move on
  // to the connect-cloud demo; users who joined an existing team land straight
  // in the app — the cloud demo and the real Slack bind are admin setup for a
  // workspace that is already configured (and joiners are EDITORs the backend
  // would 403 anyway).
  // The connect-a-cloud demo is parked, not deleted: onboarding asks for
  // nothing real, and a simulated bind was still one more thing to sit through
  // before Slack — the one connection here that IS real. Its steps
  // ('integration' / 'binding') and everything they render are left intact, so
  // putting it back is this one line.
  const handleSecurityAck = useCallback(() => {
    if (joinedExisting) {
      onFinish(teamId ?? currentTeamId)

      return
    }
    setChatStep('slack')
  }, [joinedExisting, onFinish, teamId, currentTeamId, setChatStep])

  const handlePickProvider = useCallback(
    (provider: OnboardingProvider) => {
      const id = teamId ?? currentTeamId

      if (!id) {
        setChatStep('workspace')

        return
      }
      setTeamId(id)
      setSelectedProvider(provider)
      setChatStep('binding')
    },
    [teamId, currentTeamId, setChatStep, setTeamId, setSelectedProvider],
  )

  // "Continue" on the chips row advances to the Slack closing step, whether
  // the user played the simulated bind demo or skipped it outright.
  const handleIntegrationNext = useCallback(() => setChatStep('slack'), [setChatStep])

  // The simulated bind demo finished its closing line — let it land for a
  // beat, then move on to Slack. Mirrors the old "let the message land before
  // the dialog opens" cadence, just with nothing left to dialog.
  const handleBindingDone = useCallback(() => {
    if (demoAdvanceTimerRef.current !== null) {
      window.clearTimeout(demoAdvanceTimerRef.current)
    }
    demoAdvanceTimerRef.current = window.setTimeout(() => {
      demoAdvanceTimerRef.current = null
      setChatStep('slack')
    }, 900)
  }, [demoAdvanceTimerRef, setChatStep])

  const handleConnectSlack = useCallback(() => {
    const id = teamId ?? currentTeamId

    if (!id) {
      setChatStep('workspace')

      return
    }
    setTeamId(id)
    setSlackBinding(true)
    // Same cadence as the provider dialogs: let the "authorize in the pop-up"
    // message land before the dialog opens.
    if (bindDialogTimerRef.current !== null) {
      window.clearTimeout(bindDialogTimerRef.current)
    }
    bindDialogTimerRef.current = window.setTimeout(() => {
      bindDialogTimerRef.current = null
      setSlackDialogOpen(true)
    }, 700)
  }, [
    teamId,
    currentTeamId,
    setChatStep,
    setTeamId,
    setSlackBinding,
    bindDialogTimerRef,
    setSlackDialogOpen,
  ])

  const handleSlackDialogClose = useCallback(() => {
    setSlackDialogOpen(false)
    setSlackBinding(false)
  }, [setSlackDialogOpen, setSlackBinding])

  // How the Slack step ended — the conversation closes on it rather than the
  // app appearing the instant a button is pressed.
  const [slackOutcome, setSlackOutcome] = useState<SlackOutcome>(null)
  const handleSlackBound = useCallback(() => {
    setSlackDialogOpen(false)
    setSlackBinding(false)
    setSlackOutcome('connected')
  }, [setSlackDialogOpen, setSlackBinding])

  const handleSkipSlack = useCallback(() => setSlackOutcome('skipped'), [])

  const handleEnterApp = useCallback(
    () => onFinish(teamId ?? currentTeamId),
    [onFinish, teamId, currentTeamId],
  )

  return {
    handleSecurityAck,
    handlePickProvider,
    handleIntegrationNext,
    handleBindingDone,
    handleConnectSlack,
    handleSlackDialogClose,
    slackOutcome,
    handleSlackBound,
    handleSkipSlack,
    handleEnterApp,
  }
}
