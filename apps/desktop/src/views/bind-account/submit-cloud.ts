import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { ARN_PATTERN, AZURE_GUID_PATTERN, SA_PATTERN } from '../../lib/cloudBindSteps'

import {
  ALIYUN_OIDC_PROVIDER_ARN_PATTERN,
  ALIYUN_ROLE_ARN_PATTERN,
  errorMessage,
  HUAWEI_AGENCY_NAME_PATTERN,
  HUAWEI_DOMAIN_ID_PATTERN,
  HUAWEI_IDP_NAME_PATTERN,
  TENCENT_ROLE_ARN_PATTERN,
  TRN_PATTERN,
} from './constants'

import type { SubmitEnv } from './submit-env'
import type { BindState } from './use-bind-state'

export async function submitAws(st: BindState, env: SubmitEnv) {
  const { roleArn, setError, setSubmitting, reset } = st

  if (!ARN_PATTERN.test(roleArn.trim())) {
    setError('Invalid ARN. Must be like arn:aws:iam::123456789012:role/NuphosRole')

    return
  }
  setSubmitting(true)
  try {
    await api.atlasBindAwsAccount(env.teamId, roleArn.trim())
    reset()
    env.onBound()
    env.onClose()
  } catch (e) {
    setError(errorMessage(e))
    setSubmitting(false)
  }
}

export async function submitGcp(st: BindState, env: SubmitEnv) {
  const { saEmail, projectId, setError, setSubmitting, reset } = st

  if (!SA_PATTERN.test(saEmail.trim())) {
    setError('Invalid service account email.')

    return
  }
  if (!projectId.trim()) {
    setError('Project ID is required.')

    return
  }
  setSubmitting(true)
  try {
    const bound = await api.atlasBindGcpProject(env.teamId, saEmail.trim(), projectId.trim())

    // Error toasts persist until dismissed, which is what a "go grant one
    // more role" instruction needs — the bind itself succeeded.
    for (const warning of bound?.warnings ?? []) {
      toast.error('GCP project bound with a gap', warning)
    }
    reset()
    env.onBound()
    env.onClose()
  } catch (e) {
    setError(errorMessage(e))
    setSubmitting(false)
  }
}

export async function submitTencent(st: BindState, env: SubmitEnv) {
  const { setSubmitting, reset } = st
  const label = st.tencentLabel.trim()
  const roleArn = st.tencentRoleArn.trim()
  const providerId = st.tencentProviderId.trim()

  if (!label) {
    toast.error('Label is required')

    return
  }
  if (!TENCENT_ROLE_ARN_PATTERN.test(roleArn)) {
    toast.error('Invalid role ARN. Must be like qcs::cam::uin/123456789:roleName/Nuphos')

    return
  }
  if (!providerId) {
    toast.error('OIDC provider name is required')

    return
  }
  setSubmitting(true)
  try {
    await api.atlasBindTencentAccount(env.teamId, label, st.tencentSite, roleArn, providerId)
    reset()
    env.onBound()
    env.onClose()
  } catch (e) {
    toast.apiError('Could not connect Tencent Cloud', e, {
      fallback: 'Check the details and your connection, then try again.',
    })
    setSubmitting(false)
  }
}

export async function submitAliyun(st: BindState, env: SubmitEnv) {
  const { setSubmitting, reset } = st
  const label = st.aliyunLabel.trim()
  const roleArn = st.aliyunRoleArn.trim()
  const oidcProviderArn = st.aliyunOidcProviderArn.trim()

  if (!label) {
    toast.error('Label is required')

    return
  }
  if (!ALIYUN_ROLE_ARN_PATTERN.test(roleArn)) {
    toast.error('Invalid role ARN. Must be like acs:ram::123456789012345:role/NuphosConnector')

    return
  }
  if (!ALIYUN_OIDC_PROVIDER_ARN_PATTERN.test(oidcProviderArn)) {
    toast.error(
      'Invalid OIDC provider ARN. Must be like acs:ram::123456789012345:oidc-provider/nuphos',
    )

    return
  }
  setSubmitting(true)
  try {
    await api.atlasBindAliyunAccount(env.teamId, label, st.aliyunSite, roleArn, oidcProviderArn)
    reset()
    env.onBound()
    env.onClose()
  } catch (e) {
    toast.apiError('Could not connect Alibaba Cloud', e, {
      fallback: 'Check the details and your connection, then try again.',
    })
    setSubmitting(false)
  }
}

export async function submitVolcengine(st: BindState, env: SubmitEnv) {
  const { setSubmitting, reset } = st
  const label = st.volcengineLabel.trim()
  const roleTrn = st.volcengineRoleTrn.trim()

  if (!label) {
    toast.error('Label is required')

    return
  }
  if (!TRN_PATTERN.test(roleTrn)) {
    toast.error('Invalid role TRN. Must be like trn:iam::2100000000:role/NuphosConnector')

    return
  }
  setSubmitting(true)
  try {
    await api.atlasBindVolcengineAccount(env.teamId, label, roleTrn)
    reset()
    env.onBound()
    env.onClose()
  } catch (e) {
    toast.apiError('Could not connect Volcengine', e, {
      fallback: 'Check the details and your connection, then try again.',
    })
    setSubmitting(false)
  }
}

export async function submitHuawei(st: BindState, env: SubmitEnv) {
  const { setSubmitting, reset } = st
  const label = st.huaweiLabel.trim()
  const domainId = st.huaweiDomainId.trim()
  const idpId = st.huaweiIdpId.trim()
  const agencyName = st.huaweiAgencyName.trim()

  if (!label) {
    toast.error('Label is required')

    return
  }
  if (!HUAWEI_DOMAIN_ID_PATTERN.test(domainId)) {
    toast.error('Invalid account ID. It is the 32-character id on My Credentials')

    return
  }
  if (!HUAWEI_IDP_NAME_PATTERN.test(idpId)) {
    toast.error('Invalid identity provider name')

    return
  }
  if (!HUAWEI_AGENCY_NAME_PATTERN.test(agencyName)) {
    toast.error('Invalid trust agency name')

    return
  }
  setSubmitting(true)
  try {
    await api.atlasBindHuaweiAccount(env.teamId, label, domainId, idpId, agencyName)
    reset()
    env.onBound()
    env.onClose()
  } catch (e) {
    toast.apiError('Could not connect Huawei Cloud', e, {
      fallback: 'Check the details and your connection, then try again.',
    })
    setSubmitting(false)
  }
}

export async function submitAzure(st: BindState, env: SubmitEnv) {
  const { setSubmitting, reset } = st
  const label = st.azureLabel.trim()
  const tenantId = st.azureTenantId.trim()
  const clientId = st.azureClientId.trim()
  const subscriptionId = st.azureSubscriptionId.trim()

  if (!label) {
    toast.error('Label is required')

    return
  }
  if (
    !AZURE_GUID_PATTERN.test(tenantId) ||
    !AZURE_GUID_PATTERN.test(clientId) ||
    !AZURE_GUID_PATTERN.test(subscriptionId)
  ) {
    toast.error('Tenant, client, and subscription ids must all be GUIDs')

    return
  }
  setSubmitting(true)
  try {
    await api.atlasBindAzureAccount(env.teamId, label, tenantId, clientId, subscriptionId)
    reset()
    env.onBound()
    env.onClose()
  } catch (e) {
    toast.apiError('Could not connect Azure', e, {
      fallback: 'Check the details and your connection, then try again.',
    })
    setSubmitting(false)
  }
}
