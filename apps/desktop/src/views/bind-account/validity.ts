import { ARN_PATTERN, AZURE_GUID_PATTERN, SA_PATTERN } from '../../lib/cloudBindSteps'

import {
  ALIYUN_OIDC_PROVIDER_ARN_PATTERN,
  ALIYUN_ROLE_ARN_PATTERN,
  HUAWEI_AGENCY_NAME_PATTERN,
  HUAWEI_DOMAIN_ID_PATTERN,
  HUAWEI_IDP_NAME_PATTERN,
  TENCENT_ROLE_ARN_PATTERN,
  TRN_PATTERN,
} from './constants'

import type { Provider } from './constants'
import type { BindState } from './use-bind-state'

export function bindFormValid(st: BindState): boolean {
  return st.provider === 'aws'
    ? ARN_PATTERN.test(st.roleArn.trim())
    : st.provider === 'gcp'
      ? SA_PATTERN.test(st.saEmail.trim()) && st.projectId.trim().length > 0
      : st.provider === 'cloudflare'
        ? false // Cloudflare is OAuth-only — the footer Bind button is hidden.
        : st.provider === 'linode'
          ? st.linodeLabel.trim().length > 0 && st.linodeToken.trim().length > 0
          : st.provider === 'hetzner'
            ? st.hetznerLabel.trim().length > 0 && st.hetznerToken.trim().length > 0
            : st.provider === 'betterstack'
              ? st.betterStackLabel.trim().length > 0 &&
                (st.betterStackUptimeApiToken.trim().length > 0 ||
                  st.betterStackTelemetryApiToken.trim().length > 0)
              : st.provider === 'uptime-kuma'
                ? st.uptimeKumaLabel.trim().length > 0 &&
                  /^https?:\/\//i.test(st.uptimeKumaBaseUrl.trim()) &&
                  (st.uptimeKumaAuthToken.trim().length > 0 ||
                    (st.uptimeKumaUsername.trim().length > 0 && st.uptimeKumaPassword.length > 0))
                : st.provider === 'tailscale'
                  ? st.tailscaleLabel.trim().length > 0 &&
                    st.tailscaleClientId.trim().length > 0 &&
                    (st.tailscaleFederated || st.tailscaleClientSecret.trim().length > 0)
                  : st.provider === 'vanta'
                    ? st.vantaLabel.trim().length > 0 &&
                      st.vantaClientId.trim().length > 0 &&
                      st.vantaClientSecret.trim().length > 0
                    : st.provider === 'secureframe'
                      ? st.secureframeLabel.trim().length > 0 &&
                        st.secureframeApiKey.trim().length > 0 &&
                        st.secureframeApiSecret.trim().length > 0
                      : st.provider === 'notion'
                        ? st.notionLabel.trim().length > 0 && st.notionToken.trim().length > 0
                        : st.provider === 'upstash'
                          ? st.upstashLabel.trim().length > 0 &&
                            st.upstashEmail.trim().length > 0 &&
                            st.upstashApiKey.trim().length > 0
                          : st.provider === 'resend'
                            ? st.resendLabel.trim().length > 0 && st.resendApiKey.trim().length > 0
                            : st.provider === 'tencent'
                              ? st.tencentLabel.trim().length > 0 &&
                                TENCENT_ROLE_ARN_PATTERN.test(st.tencentRoleArn.trim()) &&
                                st.tencentProviderId.trim().length > 0 &&
                                // Don't offer Bind when we know the connector is unconfigured
                                // (binding would 503). Unknown/loading (null) stays enabled.
                                st.tencentOidc?.configured !== false
                              : st.provider === 'aliyun'
                                ? st.aliyunLabel.trim().length > 0 &&
                                  ALIYUN_ROLE_ARN_PATTERN.test(st.aliyunRoleArn.trim()) &&
                                  ALIYUN_OIDC_PROVIDER_ARN_PATTERN.test(
                                    st.aliyunOidcProviderArn.trim(),
                                  )
                                : st.provider === 'volcengine'
                                  ? st.volcengineLabel.trim().length > 0 &&
                                    TRN_PATTERN.test(st.volcengineRoleTrn.trim())
                                  : st.provider === 'huawei'
                                    ? st.huaweiLabel.trim().length > 0 &&
                                      HUAWEI_DOMAIN_ID_PATTERN.test(st.huaweiDomainId.trim()) &&
                                      HUAWEI_IDP_NAME_PATTERN.test(st.huaweiIdpId.trim()) &&
                                      HUAWEI_AGENCY_NAME_PATTERN.test(st.huaweiAgencyName.trim()) &&
                                      // Don't offer Bind when we know the connector is
                                      // unconfigured (binding would 503).
                                      st.huaweiOidc?.configured !== false
                                    : st.provider === 'azure'
                                      ? st.azureLabel.trim().length > 0 &&
                                        AZURE_GUID_PATTERN.test(st.azureTenantId.trim()) &&
                                        AZURE_GUID_PATTERN.test(st.azureClientId.trim()) &&
                                        AZURE_GUID_PATTERN.test(st.azureSubscriptionId.trim()) &&
                                        // Don't offer Bind when the connector is known-unconfigured.
                                        st.azureOidc?.configured !== false
                                      : st.zeaburToken.trim().length > 0
}

export function providerLabelOf(provider: Provider): string {
  return provider === 'aws'
    ? 'AWS'
    : provider === 'gcp'
      ? 'GCP'
      : provider === 'cloudflare'
        ? 'Cloudflare'
        : provider === 'linode'
          ? 'Linode'
          : provider === 'hetzner'
            ? 'Hetzner'
            : provider === 'betterstack'
              ? 'Better Stack'
              : provider === 'uptime-kuma'
                ? 'Uptime Kuma'
                : provider === 'tailscale'
                  ? 'Tailscale'
                  : provider === 'vanta'
                    ? 'Vanta'
                    : provider === 'secureframe'
                      ? 'Secureframe'
                      : provider === 'notion'
                        ? 'Notion'
                        : provider === 'upstash'
                          ? 'Upstash'
                          : provider === 'resend'
                            ? 'Resend'
                            : provider === 'tencent'
                              ? 'Tencent Cloud'
                              : provider === 'aliyun'
                                ? 'Alibaba Cloud'
                                : provider === 'volcengine'
                                  ? 'Volcengine'
                                  : provider === 'huawei'
                                    ? 'Huawei Cloud'
                                    : provider === 'azure'
                                      ? 'Microsoft Azure'
                                      : 'Zeabur'
}
