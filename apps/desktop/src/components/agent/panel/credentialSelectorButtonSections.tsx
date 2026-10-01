import { CredentialSectionGroup } from './CredentialSectionGroup'

import type { CredentialSelectorControl } from './credentialSections'
import type { useCredentialSections } from './credentialSelectorButtonHooks'

export function CredentialSelectorSectionList({
  sections,
  value,
  unseen,
  onChange,
}: {
  sections: ReturnType<typeof useCredentialSections>
  value: CredentialSelectorControl['value']
  unseen: CredentialSelectorControl['unseen']
  onChange: CredentialSelectorControl['onChange']
}) {
  return (
    <>
      <CredentialSectionGroup
        sections={sections.awsSections}
        selectedIds={value.awsRoleIds}
        newIds={unseen?.awsRoleIds}
        onChangeIds={(ids) => onChange({ ...value, awsRoleIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.gcpSections}
        selectedIds={value.gcpServiceAccountIds}
        newIds={unseen?.gcpServiceAccountIds}
        onChangeIds={(ids) => onChange({ ...value, gcpServiceAccountIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.linodeSections}
        selectedIds={value.linodeAccountIds}
        newIds={unseen?.linodeAccountIds}
        onChangeIds={(ids) => onChange({ ...value, linodeAccountIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.hetznerSections}
        selectedIds={value.hetznerAccountIds}
        newIds={unseen?.hetznerAccountIds}
        onChangeIds={(ids) => onChange({ ...value, hetznerAccountIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.tencentSections}
        selectedIds={value.tencentAccountIds}
        newIds={unseen?.tencentAccountIds}
        onChangeIds={(ids) => onChange({ ...value, tencentAccountIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.aliyunSections}
        selectedIds={value.aliyunAccountIds}
        newIds={unseen?.aliyunAccountIds}
        onChangeIds={(ids) => onChange({ ...value, aliyunAccountIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.volcengineSections}
        selectedIds={value.volcengineAccountIds}
        newIds={unseen?.volcengineAccountIds}
        onChangeIds={(ids) => onChange({ ...value, volcengineAccountIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.huaweiSections}
        selectedIds={value.huaweiAccountIds}
        newIds={unseen?.huaweiAccountIds}
        onChangeIds={(ids) => onChange({ ...value, huaweiAccountIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.azureSections}
        selectedIds={value.azureAccountIds}
        newIds={unseen?.azureAccountIds}
        onChangeIds={(ids) => onChange({ ...value, azureAccountIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.onpremSections}
        selectedIds={value.onpremClusterIds}
        newIds={unseen?.onpremClusterIds}
        onChangeIds={(ids) => onChange({ ...value, onpremClusterIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.deviceSections}
        selectedIds={value.deviceIds}
        newIds={unseen?.deviceIds}
        onChangeIds={(ids) => onChange({ ...value, deviceIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.vantaSections}
        selectedIds={value.vantaIntegrationIds}
        newIds={unseen?.vantaIntegrationIds}
        onChangeIds={(ids) => onChange({ ...value, vantaIntegrationIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.secureframeSections}
        selectedIds={value.secureframeIntegrationIds}
        newIds={unseen?.secureframeIntegrationIds}
        onChangeIds={(ids) => onChange({ ...value, secureframeIntegrationIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.resendSections}
        selectedIds={value.resendIntegrationIds}
        newIds={unseen?.resendIntegrationIds}
        onChangeIds={(ids) => onChange({ ...value, resendIntegrationIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.betterStackSections}
        selectedIds={value.betterStackIntegrationIds}
        newIds={unseen?.betterStackIntegrationIds}
        onChangeIds={(ids) => onChange({ ...value, betterStackIntegrationIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.uptimeKumaSections}
        selectedIds={value.uptimeKumaInstanceIds}
        newIds={unseen?.uptimeKumaInstanceIds}
        onChangeIds={(ids) => onChange({ ...value, uptimeKumaInstanceIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.linearSections}
        selectedIds={value.linearWorkspaceIds}
        newIds={unseen?.linearWorkspaceIds}
        onChangeIds={(ids) => onChange({ ...value, linearWorkspaceIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.jiraSections}
        selectedIds={value.jiraSiteIds}
        newIds={unseen?.jiraSiteIds}
        onChangeIds={(ids) => onChange({ ...value, jiraSiteIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.asanaSections}
        selectedIds={value.asanaAccountIds}
        newIds={unseen?.asanaAccountIds}
        onChangeIds={(ids) => onChange({ ...value, asanaAccountIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.sentrySections}
        selectedIds={value.sentryAccountIds}
        newIds={unseen?.sentryAccountIds}
        onChangeIds={(ids) => onChange({ ...value, sentryAccountIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.posthogSections}
        selectedIds={value.posthogIntegrationIds}
        onChangeIds={(ids) => onChange({ ...value, posthogIntegrationIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.tailscaleSections}
        selectedIds={value.tailscaleClientIds}
        newIds={unseen?.tailscaleClientIds}
        onChangeIds={(ids) => onChange({ ...value, tailscaleClientIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.zeaburSections}
        selectedIds={value.zeaburIds}
        newIds={unseen?.zeaburIds}
        onChangeIds={(ids) => onChange({ ...value, zeaburIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.githubSections}
        selectedIds={value.githubInstallationIds}
        newIds={unseen?.githubInstallationIds}
        onChangeIds={(ids) => onChange({ ...value, githubInstallationIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.gitlabSections}
        selectedIds={value.gitlabBindingIds}
        newIds={unseen?.gitlabBindingIds}
        onChangeIds={(ids) => onChange({ ...value, gitlabBindingIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.grafanaSections}
        selectedIds={value.grafanaInstanceIds}
        newIds={unseen?.grafanaInstanceIds}
        onChangeIds={(ids) => onChange({ ...value, grafanaInstanceIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.sonarqubeSections}
        selectedIds={value.sonarqubeIntegrationIds}
        newIds={unseen?.sonarqubeIntegrationIds}
        onChangeIds={(ids) => onChange({ ...value, sonarqubeIntegrationIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.notionSections}
        selectedIds={value.notionIntegrationIds}
        newIds={unseen?.notionIntegrationIds}
        onChangeIds={(ids) => onChange({ ...value, notionIntegrationIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.upstashSections}
        selectedIds={value.upstashAccountIds}
        newIds={unseen?.upstashAccountIds}
        onChangeIds={(ids) => onChange({ ...value, upstashAccountIds: ids })}
      />
      <CredentialSectionGroup
        sections={sections.cloudflareSections}
        selectedIds={value.cloudflareAccountIds}
        newIds={unseen?.cloudflareAccountIds}
        onChangeIds={(ids) => onChange({ ...value, cloudflareAccountIds: ids })}
      />
    </>
  )
}
