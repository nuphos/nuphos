import { useMemo } from 'react'

import {
  buildAliyunCredentialSections,
  buildAwsCredentialSections,
  buildDeviceCredentialSections,
  buildGcpCredentialSections,
  buildHetznerCredentialSections,
  buildHuaweiCredentialSections,
  buildLinodeCredentialSections,
  buildOnpremCredentialSections,
  buildTencentCredentialSections,
  buildVolcengineCredentialSections,
  buildZeaburCredentialSections,
} from './credentialSections'
import {
  buildAsanaCredentialSections,
  buildAzureCredentialSections,
  buildBetterStackCredentialSections,
  buildJiraCredentialSections,
  buildLinearCredentialSections,
  buildResendCredentialSections,
  buildSecureframeCredentialSections,
  buildPosthogCredentialSections,
  buildSentryCredentialSections,
  buildTailscaleCredentialSections,
  buildUptimeKumaCredentialSections,
  buildVantaCredentialSections,
} from './credentialSectionsB'
import {
  buildCloudflareCredentialSections,
  buildGithubCredentialSections,
  buildGitlabCredentialSections,
  buildGrafanaCredentialSections,
  buildNotionCredentialSections,
  buildSonarqubeCredentialSections,
  buildUpstashCredentialSections,
} from './credentialSectionsC'

import type { CredentialSelectorControl } from './credentialSections'

export function useCredentialSections(options: CredentialSelectorControl['options']) {
  const awsSections = useMemo(
    () => buildAwsCredentialSections(options.awsRoles),
    [options.awsRoles],
  )
  const gcpSections = useMemo(
    () => buildGcpCredentialSections(options.gcpServiceAccounts),
    [options.gcpServiceAccounts],
  )
  const zeaburSections = useMemo(
    () => buildZeaburCredentialSections(options.zeaburProviders),
    [options.zeaburProviders],
  )
  const linodeSections = useMemo(
    () => buildLinodeCredentialSections(options.linodeAccounts),
    [options.linodeAccounts],
  )
  const hetznerSections = useMemo(
    () => buildHetznerCredentialSections(options.hetznerAccounts),
    [options.hetznerAccounts],
  )
  const tencentSections = useMemo(
    () => buildTencentCredentialSections(options.tencentAccounts),
    [options.tencentAccounts],
  )
  const aliyunSections = useMemo(
    () => buildAliyunCredentialSections(options.aliyunAccounts),
    [options.aliyunAccounts],
  )
  const volcengineSections = useMemo(
    () => buildVolcengineCredentialSections(options.volcengineAccounts),
    [options.volcengineAccounts],
  )
  const huaweiSections = useMemo(
    () => buildHuaweiCredentialSections(options.huaweiAccounts),
    [options.huaweiAccounts],
  )
  const azureSections = useMemo(
    () => buildAzureCredentialSections(options.azureAccounts),
    [options.azureAccounts],
  )
  const onpremSections = useMemo(
    () => buildOnpremCredentialSections(options.onpremClusters),
    [options.onpremClusters],
  )
  const deviceSections = useMemo(
    () => buildDeviceCredentialSections(options.devices),
    [options.devices],
  )
  const vantaSections = useMemo(
    () => buildVantaCredentialSections(options.vantaIntegrations),
    [options.vantaIntegrations],
  )
  const secureframeSections = useMemo(
    () => buildSecureframeCredentialSections(options.secureframeIntegrations),
    [options.secureframeIntegrations],
  )
  const resendSections = useMemo(
    () => buildResendCredentialSections(options.resendIntegrations),
    [options.resendIntegrations],
  )
  const betterStackSections = useMemo(
    () => buildBetterStackCredentialSections(options.betterStackIntegrations),
    [options.betterStackIntegrations],
  )
  const uptimeKumaSections = useMemo(
    () => buildUptimeKumaCredentialSections(options.uptimeKumaInstances),
    [options.uptimeKumaInstances],
  )
  const linearSections = useMemo(
    () => buildLinearCredentialSections(options.linearWorkspaces),
    [options.linearWorkspaces],
  )
  const jiraSections = useMemo(
    () => buildJiraCredentialSections(options.jiraSites),
    [options.jiraSites],
  )
  const asanaSections = useMemo(
    () => buildAsanaCredentialSections(options.asanaAccounts),
    [options.asanaAccounts],
  )
  const sentrySections = useMemo(
    () => buildSentryCredentialSections(options.sentryAccounts),
    [options.sentryAccounts],
  )
  const posthogSections = useMemo(
    () => buildPosthogCredentialSections(options.posthogIntegrations),
    [options.posthogIntegrations],
  )
  const tailscaleSections = useMemo(
    () => buildTailscaleCredentialSections(options.tailscaleClients),
    [options.tailscaleClients],
  )
  const githubSections = useMemo(
    () => buildGithubCredentialSections(options.githubInstallations),
    [options.githubInstallations],
  )
  const gitlabSections = useMemo(
    () => buildGitlabCredentialSections(options.gitlabBindings),
    [options.gitlabBindings],
  )
  const grafanaSections = useMemo(
    () => buildGrafanaCredentialSections(options.grafanaInstances),
    [options.grafanaInstances],
  )
  const sonarqubeSections = useMemo(
    () => buildSonarqubeCredentialSections(options.sonarqubeIntegrations),
    [options.sonarqubeIntegrations],
  )
  const notionSections = useMemo(
    () => buildNotionCredentialSections(options.notionIntegrations),
    [options.notionIntegrations],
  )
  const upstashSections = useMemo(
    () => buildUpstashCredentialSections(options.upstashAccounts),
    [options.upstashAccounts],
  )
  const cloudflareSections = useMemo(
    () => buildCloudflareCredentialSections(options.cloudflareAccounts),
    [options.cloudflareAccounts],
  )

  return {
    awsSections,
    gcpSections,
    zeaburSections,
    linodeSections,
    hetznerSections,
    tencentSections,
    aliyunSections,
    volcengineSections,
    huaweiSections,
    azureSections,
    onpremSections,
    deviceSections,
    vantaSections,
    secureframeSections,
    resendSections,
    betterStackSections,
    uptimeKumaSections,
    linearSections,
    jiraSections,
    asanaSections,
    sentrySections,
    posthogSections,
    tailscaleSections,
    githubSections,
    gitlabSections,
    grafanaSections,
    sonarqubeSections,
    notionSections,
    upstashSections,
    cloudflareSections,
  }
}
