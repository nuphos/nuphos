import { AliyunBindWizard } from './aliyun'
import { AwsBindWizard } from './aws'
import { AzureBindWizard } from './azure'
import { CloudflareConnect } from './cloudflare'
import { SecureframeForm, TailscaleForm, VantaForm } from './forms-access'
import { BetterStackForm, HetznerForm, LinodeForm, UptimeKumaForm } from './forms-hosting'
import { NotionForm, ResendForm, UpstashForm, ZeaburForm } from './forms-saas'
import { GcpBindWizard } from './gcp'
import { HuaweiBindWizard } from './huawei'
import { TencentBindWizard } from './tencent'
import { VolcengineBindWizard } from './volcengine'

import type { BindState } from './use-bind-state'

export function BindDialogBody({
  st,
  teamId,
  firstRun,
  onConnectCloudflare,
}: {
  st: BindState
  teamId: string
  firstRun: boolean
  onConnectCloudflare: (scopes: string[]) => void
}) {
  const { provider, purpose } = st

  return (
    <>
      {provider === 'aws' ? (
        <AwsBindWizard
          step={st.awsStep}
          teamId={teamId}
          roleArn={st.roleArn}
          onRoleArnChange={st.setRoleArn}
          purpose={purpose}
          firstRun={firstRun}
        />
      ) : provider === 'gcp' ? (
        <GcpBindWizard
          step={st.gcpStep}
          purpose={purpose}
          firstRun={firstRun}
          wif={st.gcpWif}
          saEmail={st.saEmail}
          onSaEmailChange={st.setSaEmail}
          projectId={st.projectId}
          onProjectIdChange={st.setProjectId}
        />
      ) : provider === 'cloudflare' ? (
        <CloudflareConnect st={st} onConnect={onConnectCloudflare} />
      ) : provider === 'linode' ? (
        <LinodeForm st={st} />
      ) : provider === 'hetzner' ? (
        <HetznerForm st={st} />
      ) : provider === 'betterstack' ? (
        <BetterStackForm st={st} />
      ) : provider === 'uptime-kuma' ? (
        <UptimeKumaForm st={st} />
      ) : provider === 'tailscale' ? (
        <TailscaleForm st={st} teamId={teamId} />
      ) : provider === 'vanta' ? (
        <VantaForm st={st} />
      ) : provider === 'secureframe' ? (
        <SecureframeForm st={st} />
      ) : provider === 'notion' ? (
        <NotionForm st={st} />
      ) : provider === 'upstash' ? (
        <UpstashForm st={st} />
      ) : provider === 'resend' ? (
        <ResendForm st={st} />
      ) : provider === 'tencent' ? (
        <TencentBindWizard
          step={st.tencentStep}
          oidc={st.tencentOidc}
          site={st.tencentSite}
          onSiteChange={st.setTencentSite}
          label={st.tencentLabel}
          onLabelChange={st.setTencentLabel}
          roleArn={st.tencentRoleArn}
          onRoleArnChange={st.setTencentRoleArn}
          providerId={st.tencentProviderId}
          onProviderIdChange={st.setTencentProviderId}
        />
      ) : provider === 'aliyun' ? (
        <AliyunBindWizard
          step={st.aliyunStep}
          oidc={st.aliyunOidc}
          site={st.aliyunSite}
          onSiteChange={st.setAliyunSite}
          label={st.aliyunLabel}
          onLabelChange={st.setAliyunLabel}
          roleArn={st.aliyunRoleArn}
          onRoleArnChange={st.setAliyunRoleArn}
          oidcProviderArn={st.aliyunOidcProviderArn}
          onOidcProviderArnChange={st.setAliyunOidcProviderArn}
        />
      ) : provider === 'volcengine' ? (
        <VolcengineBindWizard
          step={st.volcengineStep}
          oidc={st.volcengineOidc}
          label={st.volcengineLabel}
          onLabelChange={st.setVolcengineLabel}
          roleTrn={st.volcengineRoleTrn}
          onRoleTrnChange={st.setVolcengineRoleTrn}
        />
      ) : provider === 'huawei' ? (
        <HuaweiBindWizard
          step={st.huaweiStep}
          oidc={st.huaweiOidc}
          label={st.huaweiLabel}
          onLabelChange={st.setHuaweiLabel}
          domainId={st.huaweiDomainId}
          onDomainIdChange={st.setHuaweiDomainId}
          idpId={st.huaweiIdpId}
          onIdpIdChange={st.setHuaweiIdpId}
          agencyName={st.huaweiAgencyName}
          onAgencyNameChange={st.setHuaweiAgencyName}
        />
      ) : provider === 'azure' ? (
        <AzureBindWizard
          step={st.azureStep}
          oidc={st.azureOidc}
          purpose={purpose}
          firstRun={firstRun}
          label={st.azureLabel}
          onLabelChange={st.setAzureLabel}
          tenantId={st.azureTenantId}
          onTenantIdChange={st.setAzureTenantId}
          clientId={st.azureClientId}
          onClientIdChange={st.setAzureClientId}
          subscriptionId={st.azureSubscriptionId}
          onSubscriptionIdChange={st.setAzureSubscriptionId}
        />
      ) : (
        <ZeaburForm st={st} />
      )}
    </>
  )
}
