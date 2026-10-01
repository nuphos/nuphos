import { useEffect } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { useResetOnKey } from '../useResetOnKey'

import { useCloudProviderState } from './use-cloud-state'
import { useTokenProviderState } from './use-token-state'

import type { Provider } from './constants'

export type BindState = ReturnType<typeof useBindAccountState>

export function useBindAccountState(initialProvider: Provider) {
  const cloud = useCloudProviderState(initialProvider)
  const token = useTokenProviderState()

  function reset() {
    cloud.resetCloudState()
    token.resetTokenState()
  }

  return { ...cloud, ...token, reset }
}

export function useBindDialogEffects(st: BindState, open: boolean, teamId: string) {
  const {
    provider,
    setVolcengineOidc,
    setHuaweiOidc,
    setAzureOidc,
    setGcpWif,
    setAliyunOidc,
    setTencentOidc,
  } = st

  // Fetch the OIDC federation details when the Volcengine form is shown, so the
  // setup instructions can show the issuer / audience / subject the customer
  // registers. Best-effort: on failure the block just stays hidden.
  useEffect(() => {
    if (!open || provider !== 'volcengine') return
    let cancelled = false

    void api
      .atlasGetVolcengineOidcInfo(teamId)
      .then((info) => {
        if (!cancelled) setVolcengineOidc(info)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setVolcengineOidc(null)
        // Surface the failure instead of silently rendering hard-coded defaults:
        // a wrong issuer/audience/subject would guide the user to author a trust
        // policy that doesn't match the backend.
        toast.apiError('Could not load Volcengine setup details', e)
      })

    return () => {
      cancelled = true
    }
  }, [open, provider, teamId, setVolcengineOidc])

  // Same for Huawei Cloud: the issuer / audience / subject the customer puts
  // on the IAM identity provider and its trust agency's condition. Best-effort.
  useEffect(() => {
    if (!open || provider !== 'huawei') return
    let cancelled = false

    void api
      .atlasGetHuaweiOidcInfo(teamId)
      .then((info) => {
        if (!cancelled) setHuaweiOidc(info)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setHuaweiOidc(null)
        toast.apiError('Could not load Huawei Cloud setup details', e)
      })

    return () => {
      cancelled = true
    }
  }, [open, provider, teamId, setHuaweiOidc])

  // Fetch the OIDC federation details when the Azure form is shown, so the setup
  // instructions can show the issuer / subject / audience the customer pins on
  // the app's federated credential. Best-effort.
  // Clear any prior team's details first — otherwise a teamId change while the
  // dialog is open would show the previous team's subject and mis-scope the
  // federated credential.
  useResetOnKey(`${String(open)}|${provider}|${teamId}`, () => {
    if (open && provider === 'azure') setAzureOidc(null)
  })
  useEffect(() => {
    if (!open || provider !== 'azure') return
    let cancelled = false

    void api
      .atlasGetAzureOidcInfo(teamId)
      .then((info) => {
        if (!cancelled) setAzureOidc(info)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setAzureOidc(null)
        toast.apiError('Could not load Azure setup details', e)
      })

    return () => {
      cancelled = true
    }
  }, [open, provider, teamId, setAzureOidc])

  // Same, for GCP: the principal the customer grants Token Creator to is scoped
  // to this team, so it is fetched rather than hard-coded — and cleared on a team
  // change, or the wizard would hand out another team's principal and the grant
  // would silently authorize nobody.
  useResetOnKey(`${String(open)}|${provider}|${teamId}`, () => {
    if (open && provider === 'gcp') setGcpWif(null)
  })
  useEffect(() => {
    if (!open || provider !== 'gcp') return
    let cancelled = false

    void api
      .atlasGetGcpWifInfo(teamId)
      .then((info) => {
        if (!cancelled) setGcpWif(info)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setGcpWif(null)
        toast.apiError('Could not load GCP setup details', e)
      })

    return () => {
      cancelled = true
    }
  }, [open, provider, teamId, setGcpWif])

  // Same, for the Alibaba Cloud form.
  useEffect(() => {
    if (!open || provider !== 'aliyun') return
    let cancelled = false

    void api
      .atlasGetAliyunOidcInfo(teamId)
      .then((info) => {
        if (!cancelled) setAliyunOidc(info)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setAliyunOidc(null)
        toast.apiError('Could not load Alibaba Cloud setup details', e)
      })

    return () => {
      cancelled = true
    }
  }, [open, provider, teamId, setAliyunOidc])

  // Same, for the Tencent Cloud form.
  // Clear the previous team's details so a stale subject/issuer isn't copyable
  // while the new request is in flight (teamId can change with the dialog open).
  useResetOnKey(`${String(open)}|${provider}|${teamId}`, () => {
    if (open && provider === 'tencent') setTencentOidc(null)
  })
  useEffect(() => {
    if (!open || provider !== 'tencent') return
    let cancelled = false

    void api
      .atlasGetTencentOidcInfo(teamId)
      .then((info) => {
        if (!cancelled) setTencentOidc(info)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setTencentOidc(null)
        toast.apiError('Could not load Tencent Cloud setup details', e)
      })

    return () => {
      cancelled = true
    }
  }, [open, provider, teamId, setTencentOidc])
}
