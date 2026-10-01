import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { api } from '../../../api'
import { track } from '../../../lib/analytics'
import {
  FIRST_RUN_CONVO_EVENT,
  FIRST_RUN_DEV_STAGE_EVENT,
  isFirstRunProvider,
} from '../../../lib/firstRunConnect'

import { PROMPT_LANG_KEY, readProgress, readPromptLang, setupTitles } from './progress'

import type { Purpose, Stage } from './progress'
import type {
  FirstRunConvoPhase,
  FirstRunDevStage,
  FirstRunPromptLang,
  FirstRunProvider,
} from '../../../lib/firstRunConnect'
import type { AzureOidcInfo, GcpWifInfo } from '../../../types'

export function useFirstRunPanelState({ open, teamId }: { open: boolean; teamId: string }) {
  const [stage, setStage] = useState<Stage>({ kind: 'pick', provider: null })
  const [setupStep, setSetupStep] = useState(0)
  // Which language the handed-out prompts are in. Picked once on the
  // first-question screen; every later prompt follows it.
  const [promptLang, setPromptLang] = useState<FirstRunPromptLang>(readPromptLang)
  const pickPromptLang = useCallback((lang: FirstRunPromptLang) => {
    setPromptLang(lang)
    try {
      localStorage.setItem(PROMPT_LANG_KEY, lang)
    } catch {
      // Storage unavailable — the pick simply lasts for this mount.
    }
  }, [])
  const [advancing, setAdvancing] = useState(false)
  const advanceTimerRef = useRef<number | null>(null)
  const contentScrollRef = useRef<HTMLDivElement>(null)
  const [submitting, setSubmitting] = useState(false)

  // Per-provider inputs. The step content components own the fields; the panel
  // owns the values so it can validate and submit them.
  const [roleArn, setRoleArn] = useState('')
  const [saEmail, setSaEmail] = useState('')
  const [projectId, setProjectId] = useState('')
  const [azureLabel, setAzureLabel] = useState('')
  const [azureTenantId, setAzureTenantId] = useState('')
  const [azureClientId, setAzureClientId] = useState('')
  const [azureSubscriptionId, setAzureSubscriptionId] = useState('')
  const [azureOidc, setAzureOidc] = useState<AzureOidcInfo | null>(null)
  const [gcpWif, setGcpWif] = useState<GcpWifInfo | null>(null)

  const clearInputs = useCallback(() => {
    setRoleArn('')
    setSaEmail('')
    setProjectId('')
    setAzureLabel('')
    setAzureTenantId('')
    setAzureClientId('')
    setAzureSubscriptionId('')
  }, [])

  const activeProvider = 'provider' in stage ? stage.provider : null
  const activePurpose = stage.kind === 'setup' ? stage.purpose : null
  const activeSetupStep = stage.kind === 'setup' ? setupStep : null

  // Every page/step is a new reading context. Reset before paint so the next
  // screen never flashes at the previous screen's scroll position. Conversation
  // breadcrumbs only flip asked/answered and leave these dependencies unchanged.
  useLayoutEffect(() => {
    if (contentScrollRef.current) contentScrollRef.current.scrollTop = 0
  }, [stage.kind, activeProvider, activePurpose, activeSetupStep])

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current)
    }
  }, [])

  // Dev-only console control (`onboarding.firstRun.stage(...)`): jump straight
  // to any stage. Every stage past `pick` normally costs a real cloud bind to
  // reach, which makes iterating on those screens miserable without this.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const onStage = (event: Event) => {
      const detail = (event as CustomEvent<FirstRunDevStage>).detail

      if (!detail) return
      const provider =
        detail.provider && isFirstRunProvider(detail.provider) ? detail.provider : 'aws'

      if (detail.kind === 'pick' || detail.kind === 'intro') {
        // 'intro' merged into 'pick'; the dev hook keeps the old name working
        // and lands on the same screen with the cloud already chosen.
        setStage({ kind: 'pick', provider: detail.kind === 'intro' ? provider : null })
      } else if (detail.kind === 'connected' || detail.kind === 'finished') {
        setStage({ kind: detail.kind, provider })
      } else if (detail.kind === 'first-question') {
        const phase = Math.round(detail.step ?? 0)

        setStage({
          kind: 'first-question',
          provider,
          asked: phase >= 1,
          answered: phase >= 2,
        })
      } else {
        const total = setupTitles(provider, 'operational').length

        setStage({ kind: 'setup', provider, purpose: 'operational' })
        setSetupStep(Math.min(total - 1, Math.max(0, Math.round(detail.step ?? 0))))
      }
    }

    window.addEventListener(FIRST_RUN_DEV_STAGE_EVENT, onStage)

    return () => window.removeEventListener(FIRST_RUN_DEV_STAGE_EVENT, onStage)
  }, [])

  // The journey advances on the chat's real moves, not on panel buttons: the
  // agent panel emits `asked` when a message is sent and `answered` when the
  // turn's stream ends. Only the stages waiting for those moves react — from
  // anywhere else the breadcrumbs fall on the floor.
  const stageRef = useRef(stage)

  useEffect(() => {
    stageRef.current = stage
  }, [stage])
  useEffect(() => {
    const onConvo = (event: Event) => {
      const phase = (event as CustomEvent<{ phase: FirstRunConvoPhase }>).detail?.phase

      if (phase !== 'asked' && phase !== 'answered') return
      const current = stageRef.current

      if (current.kind !== 'first-question') return
      if (phase === 'asked') {
        if (current.asked) return
        track('agent_first_run_question_asked', { provider: current.provider })
        setStage({ ...current, asked: true })
      } else {
        // `answered` fires whenever ANY turn's stream ends — including one the
        // user started before opening the guide. Without the `asked` gate the
        // panel would jump straight to "answer's in" for a question it never
        // saw sent, replacing the waiting line with the next chapter's CTA.
        if (!current.asked || current.answered) return
        track('agent_first_run_answer_received', { provider: current.provider })
        setStage({ ...current, answered: true })
      }
    }

    window.addEventListener(FIRST_RUN_CONVO_EVENT, onConvo)

    return () => window.removeEventListener(FIRST_RUN_CONVO_EVENT, onConvo)
  }, [])

  const beginSetup = useCallback(
    (provider: FirstRunProvider, purpose: Purpose) => {
      const total = setupTitles(provider, purpose).length

      setSetupStep(readProgress(teamId, provider, purpose, total))
      setAdvancing(false)
      setStage({ kind: 'setup', provider, purpose })
    },
    [teamId],
  )

  // Azure's federated credential is authored against values only the backend
  // knows. Never fall back to hard-coded ones — a wrong issuer or subject would
  // walk the user into a credential that silently never matches.
  const azureNeeded = stage.kind === 'setup' && stage.provider === 'azure'

  useEffect(() => {
    if (!open || !azureNeeded || azureOidc) return
    let cancelled = false

    void api
      .atlasGetAzureOidcInfo(teamId)
      .then((info) => {
        if (!cancelled) setAzureOidc(info)
      })
      .catch(() => {
        // Best effort: the fields stay on "loading…" rather than showing a
        // value that would produce a broken trust relationship.
      })

    return () => {
      cancelled = true
    }
  }, [open, azureNeeded, azureOidc, teamId])

  // Same for GCP: the Token Creator principal is team-scoped, so it is fetched
  // rather than hard-coded — a wrong one produces a grant that authorizes nobody.
  const gcpNeeded = stage.kind === 'setup' && stage.provider === 'gcp'

  useEffect(() => {
    if (!open || !gcpNeeded || gcpWif) return
    let cancelled = false

    void api
      .atlasGetGcpWifInfo(teamId)
      .then((info) => {
        if (!cancelled) setGcpWif(info)
      })
      .catch(() => {
        // Best effort: the field stays on "loading…" rather than showing a
        // principal that would produce a grant Nuphos cannot use.
      })

    return () => {
      cancelled = true
    }
  }, [open, gcpNeeded, gcpWif, teamId])

  return {
    stage,
    setStage,
    setupStep,
    setSetupStep,
    promptLang,
    pickPromptLang,
    advancing,
    setAdvancing,
    advanceTimerRef,
    contentScrollRef,
    submitting,
    setSubmitting,
    roleArn,
    setRoleArn,
    saEmail,
    setSaEmail,
    projectId,
    setProjectId,
    azureLabel,
    setAzureLabel,
    azureTenantId,
    setAzureTenantId,
    azureClientId,
    setAzureClientId,
    azureSubscriptionId,
    setAzureSubscriptionId,
    azureOidc,
    gcpWif,
    clearInputs,
    beginSetup,
  }
}
