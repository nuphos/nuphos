import { api } from '../../api'
import { toast } from '../../components/ui/toast'

import { errorMessage } from './constants'

import type { SubmitEnv } from './submit-env'
import type { BindState } from './use-bind-state'

export async function submitVanta(st: BindState, env: SubmitEnv) {
  const { setError, setSubmitting, reset } = st
  const label = st.vantaLabel.trim()
  const clientId = st.vantaClientId.trim()
  const clientSecret = st.vantaClientSecret.trim()

  if (!label) {
    setError('Label is required.')

    return
  }
  if (!clientId || !clientSecret) {
    setError('Vanta client ID and secret are required.')

    return
  }
  setSubmitting(true)
  try {
    await api.atlasBindVantaIntegration(env.teamId, label, clientId, clientSecret)
    reset()
    env.onBound()
    env.onClose()
  } catch (e) {
    setError(errorMessage(e))
    setSubmitting(false)
  }
}

export async function submitSecureframe(st: BindState, env: SubmitEnv) {
  const { secureframeRegion, setError, setSubmitting, reset } = st
  const label = st.secureframeLabel.trim()
  const apiKey = st.secureframeApiKey.trim()
  const apiSecret = st.secureframeApiSecret.trim()

  if (!label) {
    setError('Label is required.')

    return
  }
  if (!apiKey || !apiSecret) {
    setError('Secureframe API key and secret are required.')

    return
  }
  setSubmitting(true)
  try {
    await api.atlasBindSecureframeIntegration(
      env.teamId,
      label,
      secureframeRegion,
      apiKey,
      apiSecret,
    )
    reset()
    env.onBound()
    env.onClose()
  } catch (e) {
    setError(errorMessage(e))
    setSubmitting(false)
  }
}

export async function submitNotion(st: BindState, env: SubmitEnv) {
  const { setError, setSubmitting, reset } = st
  const label = st.notionLabel.trim()
  const token = st.notionToken.trim()

  if (!label) {
    setError('Label is required.')

    return
  }
  if (!token) {
    setError('A Notion integration token is required.')

    return
  }
  setSubmitting(true)
  try {
    await api.atlasBindNotionIntegration(env.teamId, label, token)
    reset()
    env.onBound()
    env.onClose()
  } catch (e) {
    setError(errorMessage(e))
    setSubmitting(false)
  }
}

export async function submitUpstash(st: BindState, env: SubmitEnv) {
  const { setSubmitting, reset } = st
  const label = st.upstashLabel.trim()
  const email = st.upstashEmail.trim()
  const apiKey = st.upstashApiKey.trim()

  if (!label) {
    toast.error('Label is required')

    return
  }
  if (!email) {
    toast.error('Your Upstash account email is required')

    return
  }
  if (!apiKey) {
    toast.error('An Upstash Management API key is required')

    return
  }
  setSubmitting(true)
  try {
    await api.atlasBindUpstashAccount(env.teamId, label, email, apiKey)
    reset()
    env.onBound()
    env.onClose()
  } catch (e) {
    toast.apiError('Could not connect Upstash', e)
    setSubmitting(false)
  }
}

export async function submitResend(st: BindState, env: SubmitEnv) {
  const { setError, setSubmitting, reset } = st
  const label = st.resendLabel.trim()
  const apiKey = st.resendApiKey.trim()

  if (!label) {
    setError('Label is required.')

    return
  }
  if (!apiKey) {
    setError('A Resend API key is required.')

    return
  }
  setSubmitting(true)
  try {
    await api.atlasBindResendIntegration(env.teamId, label, apiKey)
    reset()
    env.onBound()
    env.onClose()
  } catch (e) {
    setError(errorMessage(e))
    setSubmitting(false)
  }
}

export async function submitZeabur(st: BindState, env: SubmitEnv) {
  const { setError, setSubmitting, reset } = st
  const token = st.zeaburToken.trim()

  if (!token) {
    setError('Zeabur API token is required.')

    return
  }
  setSubmitting(true)
  try {
    await api.atlasBindZeaburProvider(env.teamId, token)
    reset()
    env.onBound()
    env.onClose()
  } catch (e) {
    setError(errorMessage(e))
    setSubmitting(false)
  }
}
