import { useState } from 'react'

import type { Provider } from './constants'
import type {
  AliyunOidcInfo,
  AliyunSite,
  AzureOidcInfo,
  GcpWifInfo,
  HuaweiOidcInfo,
  TencentOidcInfo,
  TencentSite,
  VolcengineOidcInfo,
} from '../../types'

export function useCloudProviderState(initialProvider: Provider) {
  const [provider, setProvider] = useState<Provider>(initialProvider)
  const [roleArn, setRoleArn] = useState('')
  const [saEmail, setSaEmail] = useState('')
  const [projectId, setProjectId] = useState('')
  const [tencentLabel, setTencentLabel] = useState('')
  const [tencentSite, setTencentSite] = useState<TencentSite>('china')
  const [tencentRoleArn, setTencentRoleArn] = useState('')
  const [tencentProviderId, setTencentProviderId] = useState('')
  const [tencentOidc, setTencentOidc] = useState<TencentOidcInfo | null>(null)
  const [tencentStep, setTencentStep] = useState(0)
  const [aliyunLabel, setAliyunLabel] = useState('')
  const [aliyunSite, setAliyunSite] = useState<AliyunSite>('china')
  const [aliyunRoleArn, setAliyunRoleArn] = useState('')
  const [aliyunOidcProviderArn, setAliyunOidcProviderArn] = useState('')
  const [aliyunOidc, setAliyunOidc] = useState<AliyunOidcInfo | null>(null)
  const [aliyunStep, setAliyunStep] = useState(0)
  const [volcengineLabel, setVolcengineLabel] = useState('')
  const [volcengineRoleTrn, setVolcengineRoleTrn] = useState('')
  // OIDC federation details (issuer / audience / subject), fetched when the
  // Volcengine form opens, so the customer can register Nuphos as an IAM OIDC
  // identity provider and pin their role's trust policy. null = not yet loaded.
  const [volcengineOidc, setVolcengineOidc] = useState<VolcengineOidcInfo | null>(null)
  const [volcengineStep, setVolcengineStep] = useState(0)
  const [huaweiLabel, setHuaweiLabel] = useState('')
  const [huaweiDomainId, setHuaweiDomainId] = useState('')
  const [huaweiIdpId, setHuaweiIdpId] = useState('')
  const [huaweiAgencyName, setHuaweiAgencyName] = useState('')
  // OIDC federation details (issuer / audience / subject), fetched when the
  // Huawei Cloud form opens, so the customer can register Nuphos as an IAM
  // identity provider and map this team's subject. null = not yet loaded.
  const [huaweiOidc, setHuaweiOidc] = useState<HuaweiOidcInfo | null>(null)
  const [huaweiStep, setHuaweiStep] = useState(0)
  const [azureLabel, setAzureLabel] = useState('')
  const [azureTenantId, setAzureTenantId] = useState('')
  const [azureClientId, setAzureClientId] = useState('')
  const [azureSubscriptionId, setAzureSubscriptionId] = useState('')
  // OIDC federation details (issuer / subject / audience), fetched when the Azure
  // form opens, so the customer can add a matching federated credential to their
  // Entra app registration. null = not yet loaded.
  const [azureOidc, setAzureOidc] = useState<AzureOidcInfo | null>(null)
  const [azureStep, setAzureStep] = useState(0)
  const [awsStep, setAwsStep] = useState(0)
  const purpose = 'operational' as const
  // GCP manual setup, mirroring the AWS wizard: one step per console page.
  const [gcpStep, setGcpStep] = useState(0)
  // Which Nuphos principal the customer must grant Token Creator to, fetched
  // when the GCP form opens. It is team-scoped, so it cannot be hard-coded.
  // null = not yet loaded.
  const [gcpWif, setGcpWif] = useState<GcpWifInfo | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetCloudState() {
    setRoleArn('')
    setSaEmail('')
    setProjectId('')
    setGcpStep(0)
    setTencentLabel('')
    setTencentSite('china')
    setTencentRoleArn('')
    setTencentProviderId('')
    setTencentOidc(null)
    setTencentStep(0)
    setAliyunLabel('')
    setAliyunSite('china')
    setAliyunRoleArn('')
    setAliyunOidcProviderArn('')
    setAliyunOidc(null)
    setAliyunStep(0)
    setVolcengineLabel('')
    setVolcengineRoleTrn('')
    setVolcengineOidc(null)
    setVolcengineStep(0)
    setHuaweiLabel('')
    setHuaweiDomainId('')
    setHuaweiIdpId('')
    setHuaweiAgencyName('')
    setHuaweiOidc(null)
    setHuaweiStep(0)
    setAzureLabel('')
    setAzureTenantId('')
    setAzureClientId('')
    setAzureSubscriptionId('')
    setAzureOidc(null)
    setAzureStep(0)
    setAwsStep(0)
    setError(null)
    setSubmitting(false)
    setProvider('aws')
  }

  return {
    provider,
    setProvider,
    roleArn,
    setRoleArn,
    saEmail,
    setSaEmail,
    projectId,
    setProjectId,
    tencentLabel,
    setTencentLabel,
    tencentSite,
    setTencentSite,
    tencentRoleArn,
    setTencentRoleArn,
    tencentProviderId,
    setTencentProviderId,
    tencentOidc,
    setTencentOidc,
    tencentStep,
    setTencentStep,
    aliyunLabel,
    setAliyunLabel,
    aliyunSite,
    setAliyunSite,
    aliyunRoleArn,
    setAliyunRoleArn,
    aliyunOidcProviderArn,
    setAliyunOidcProviderArn,
    aliyunOidc,
    setAliyunOidc,
    aliyunStep,
    setAliyunStep,
    volcengineLabel,
    setVolcengineLabel,
    volcengineRoleTrn,
    setVolcengineRoleTrn,
    volcengineOidc,
    setVolcengineOidc,
    volcengineStep,
    setVolcengineStep,
    huaweiLabel,
    setHuaweiLabel,
    huaweiDomainId,
    setHuaweiDomainId,
    huaweiIdpId,
    setHuaweiIdpId,
    huaweiAgencyName,
    setHuaweiAgencyName,
    huaweiOidc,
    setHuaweiOidc,
    huaweiStep,
    setHuaweiStep,
    azureLabel,
    setAzureLabel,
    azureTenantId,
    setAzureTenantId,
    azureClientId,
    setAzureClientId,
    azureSubscriptionId,
    setAzureSubscriptionId,
    azureOidc,
    setAzureOidc,
    azureStep,
    setAzureStep,
    awsStep,
    setAwsStep,
    purpose,
    gcpStep,
    setGcpStep,
    gcpWif,
    setGcpWif,
    submitting,
    setSubmitting,
    error,
    setError,
    resetCloudState,
  }
}
