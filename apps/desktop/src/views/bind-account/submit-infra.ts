import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n/index.ts'

import { errorMessage } from './constants'

import type { SubmitEnv } from './submit-env'
import type { BindState } from './use-bind-state'

export async function submitLinode(st: BindState, env: SubmitEnv) {
  const { setError, setSubmitting, reset } = st
  const label = st.linodeLabel.trim()
  const token = st.linodeToken.trim()

  if (!label) {
    setError(t('Label is required.'))

    return
  }
  if (!token) {
    setError(t('Linode API token is required.'))

    return
  }
  setSubmitting(true)
  try {
    await api.atlasBindLinodeAccount(env.teamId, label, token)
    reset()
    env.onBound()
    env.onClose()
  } catch (e) {
    setError(errorMessage(e))
    setSubmitting(false)
  }
}

export async function submitHetzner(st: BindState, env: SubmitEnv) {
  const { setSubmitting, reset } = st
  const label = st.hetznerLabel.trim()
  const token = st.hetznerToken.trim()

  if (!label) {
    toast.error(t('Label is required'))

    return
  }
  if (!token) {
    toast.error(t('Hetzner Cloud API token is required'))

    return
  }
  setSubmitting(true)
  try {
    await api.atlasBindHetznerAccount(env.teamId, label, token)
    reset()
    env.onBound()
    env.onClose()
  } catch (e) {
    toast.apiError(t('Could not connect {name}', { name: 'Hetzner Cloud' }), e, {
      fallback: t('Check the details and your connection, then try again.'),
    })
    setSubmitting(false)
  }
}

export async function submitBetterStack(st: BindState, env: SubmitEnv) {
  const { setError, setSubmitting, reset } = st
  const label = st.betterStackLabel.trim()
  const uptimeApiToken = st.betterStackUptimeApiToken.trim()
  const telemetryApiToken = st.betterStackTelemetryApiToken.trim()

  if (!label) {
    setError(t('Label is required.'))

    return
  }
  if (!uptimeApiToken && !telemetryApiToken) {
    setError(t('Provide at least one Better Stack API token.'))

    return
  }
  setSubmitting(true)
  try {
    await api.atlasBindBetterStackIntegration(
      env.teamId,
      label,
      uptimeApiToken || null,
      telemetryApiToken || null,
    )
    reset()
    env.onBound()
    env.onClose()
  } catch (e) {
    setError(errorMessage(e))
    setSubmitting(false)
  }
}

export async function submitUptimeKuma(st: BindState, env: SubmitEnv) {
  const { setSubmitting, reset } = st
  const label = st.uptimeKumaLabel.trim()
  const baseUrl = st.uptimeKumaBaseUrl.trim()
  const username = st.uptimeKumaUsername.trim()
  const password = st.uptimeKumaPassword
  const authToken = st.uptimeKumaAuthToken.trim()

  if (!label) {
    toast.error(t('Label is required.'))

    return
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    toast.error(t('Base URL must start with http:// or https://.'))

    return
  }
  if (!authToken && (!username || !password)) {
    toast.error(t('Provide either an auth token or username/password.'))

    return
  }
  setSubmitting(true)
  try {
    await api.atlasBindUptimeKumaInstance(env.teamId, {
      label,
      baseUrl,
      ...(authToken ? { authToken } : { username, password }),
    })
    reset()
    env.onBound()
    env.onClose()
  } catch (e) {
    toast.apiError(t('Could not connect {name}', { name: 'Uptime Kuma' }), e, {
      fallback: t('Check the details and your connection, then try again.'),
    })
    setSubmitting(false)
  }
}

export async function submitTailscale(st: BindState, env: SubmitEnv) {
  const { tailscaleFederated, setSubmitting, reset } = st
  const label = st.tailscaleLabel.trim()
  const clientId = st.tailscaleClientId.trim()
  const clientSecret = st.tailscaleClientSecret.trim()

  if (!label) {
    toast.error(t('Label is required.'))

    return
  }
  if (!clientId) {
    toast.error(t('Tailscale client ID is required.'))

    return
  }
  if (!tailscaleFederated && !clientSecret) {
    toast.error(t('Tailscale OAuth client secret is required.'))

    return
  }
  setSubmitting(true)
  try {
    await api.atlasBindTailscaleClient(
      env.teamId,
      label,
      clientId,
      tailscaleFederated ? null : clientSecret,
      tailscaleFederated,
    )
    reset()
    env.onBound()
    env.onClose()
  } catch (e) {
    toast.apiError(t('Failed to bind Tailscale client'), e, {
      fallback: t('Check the details and your connection, then try again.'),
    })
    setSubmitting(false)
  }
}
