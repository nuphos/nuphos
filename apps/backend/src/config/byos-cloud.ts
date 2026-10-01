import { boundedInt, optional, optionalList } from './env'

// Direct data access plus the five clouds Nuphos reaches by web-identity
// federation. Only AWS carries the signing key / issuer / JWKS — the others
// reuse it and differ solely in the audience they pin.
export function byosCloudConfig() {
  return {
    database: {
      // Database credentials deliberately use their own encryption domain.
      // Do not fall back to a connector/BYOS key: key custody and rotation for
      // direct data access must stay independent from cloud integrations.
      encryptionKey: optional('DATABASE_CREDENTIAL_ENCRYPTION_KEY'),
      encryptionKeyId: process.env.DATABASE_CREDENTIAL_ENCRYPTION_KEY_ID ?? 'default',
      // The tsnet dialer is a private loopback-only companion process. It
      // owns tailnet node state; the backend retains database and OAuth
      // credential custody and sends only the selected OAuth secret over the
      // local authenticated channel when a private connection is used.
      tailscaleDialerUrl: optional('DATABASE_TAILSCALE_DIALER_URL'),
      tailscaleDialerToken: optional('DATABASE_TAILSCALE_DIALER_TOKEN'),
      tailscaleDialerTimeoutMs: boundedInt('DATABASE_TAILSCALE_DIALER_TIMEOUT_MS', 30_000, {
        min: 1_000,
        max: 120_000,
      }),
    },
    aws: {
      sessionDurationSec: 3600,
      oidc: {
        // RS256 signing key for the Nuphos web-identity issuer (PEM; generate
        // with `openssl genrsa 2048`). Rotation: deploy the new key, but keep
        // serving the old JWKS until outstanding tokens (tokenTtlSec) expire.
        privateKey: optional('AWS_BYOS_OIDC_PRIVATE_KEY'),
        privateKeyBase64: optional('AWS_BYOS_OIDC_PRIVATE_KEY_BASE64'),
        // Comma-separated base64-encoded PEM public keys served in the JWKS
        // alongside the active key — the rotation overlap window (publish the
        // next key before signing with it; keep the old key until in-flight
        // tokens + JWKS caches expire).
        additionalPublicKeysBase64: optionalList('AWS_BYOS_OIDC_ADDITIONAL_PUBLIC_KEYS_BASE64'),
        // Issuer URL customers register as their IAM OIDC provider. Must be
        // the public HTTPS origin serving /.well-known/openid-configuration
        // (no port, per AWS rules). Defaults to auth.publicBaseUrl.
        issuer: optional('AWS_BYOS_OIDC_ISSUER'),
        audience: 'sts.amazonaws.com',
        tokenTtlSec: 300,
      },
    },
    gcp: {
      tokenLifetimeSec: 3600,
      // OIDC workload identity federation (like AWS/Azure/Tencent/Aliyun/
      // Volcengine): the pool and provider live in *Nuphos's own* GCP project and
      // trust the shared Nuphos issuer, so customers create nothing — they grant
      // Token Creator on their service account to
      //   principal://iam.googleapis.com/projects/<projectNumber>/locations/global/
      //     workloadIdentityPools/<poolId>/subject/nuphos:team:<teamId>
      // and Google itself enforces that a token minted for team A can never
      // impersonate team B's service account. The signing key / issuer / JWKS come
      // from byos.aws.oidc; the audience is the provider's own resource path.
      wif: {
        // Numeric project number (not the project ID) of the Nuphos project that
        // owns the pool — the principal:// identifier only accepts the number.
        projectNumber: optional('GCP_BYOS_WIF_PROJECT_NUMBER'),
        poolId: optional('GCP_BYOS_WIF_POOL_ID'),
        providerId: optional('GCP_BYOS_WIF_PROVIDER_ID'),
      },
    },
    tencent: {
      // OIDC web-identity federation (like AWS/Aliyun/Volcengine): the customer
      // creates a CAM OIDC identity provider (issuer + JWKS shared with the AWS
      // connector — one Nuphos IdP) and a CAM role trusting it, and Nuphos stores
      // only the role ARN + provider name. At runtime Nuphos mints a per-team
      // token and calls sts:AssumeRoleWithWebIdentity — no static Tencent keys.
      // The signing key / issuer / JWKS come from byos.aws.oidc; only the
      // audience differs — it is the client id the customer configures on the
      // OIDC provider, pinned as the token `aud`.
      oidc: {
        audience: 'sts.tencentcloudapi.com',
        sessionDurationSec: 3600,
      },
    },
    aliyun: {
      // OIDC web-identity federation (like AWS/Volcengine): the customer creates
      // a RAM OIDC identity provider (issuer + JWKS shared with the AWS connector
      // — one Nuphos IdP) and a RAM role trusting it, and Nuphos stores only the
      // role ARN. At runtime Nuphos mints a per-team token and calls
      // sts:AssumeRoleWithOIDC — unsigned, no static Aliyun keys. The signing key
      // / issuer / JWKS come from byos.aws.oidc; only the audience differs — it is
      // the client id the customer configures on the OIDC provider, pinned as the
      // token `aud`.
      oidc: {
        audience: 'sts.aliyuncs.com',
        sessionDurationSec: 3600,
      },
    },
    volcengine: {
      // OIDC web-identity federation (like AWS): the customer registers Nuphos
      // as an IAM OIDC identity provider (issuer + JWKS below, shared with the
      // AWS connector — one Nuphos IdP), creates a role trusting it, and Nuphos
      // stores only the role TRN. At runtime Nuphos mints a per-team RS256 token
      // and calls sts:AssumeRoleWithOIDC — unsigned, no static Volcengine keys.
      // The signing key / issuer / JWKS come from byos.aws.oidc; only the
      // audience differs. `audience` is the client id the customer enters when
      // registering the OIDC provider, and it is pinned as the token `aud`.
      oidc: {
        audience: 'sts.volcengineapi.com',
        sessionDurationSec: 3600,
      },
    },
    huawei: {
      // OIDC federation via IAM5 trust agencies: the customer registers Nuphos
      // as an OIDC provider (issuer + JWKS shared with the AWS connector — one
      // Nuphos IdP) and assigns a trust agency to its audience; Nuphos stores
      // the account (domain) id, provider name, and agency name. At runtime
      // Nuphos mints a per-team token and calls STS AssumeAgencyWithOIDC — no
      // static Huawei keys. The signing key / issuer / JWKS come from
      // byos.aws.oidc; only the audience differs — it is the client id the
      // customer registers on the provider, pinned as the token `aud`.
      oidc: {
        audience: 'iam.myhuaweicloud.com',
        sessionDurationSec: 3600,
      },
    },
    azure: {
      // OIDC workload identity federation (like AWS/Tencent/Aliyun/Volcengine):
      // the customer creates an Entra ID app registration with a federated
      // credential trusting the Nuphos issuer (issuer + JWKS shared with the AWS
      // connector — one Nuphos IdP) and grants it an Azure RBAC role on a
      // subscription. Nuphos stores only tenantId + clientId + subscriptionId — no
      // client secret — mints a per-team token, and exchanges it for an ARM access
      // token at the Entra token endpoint (grant_type=client_credentials +
      // client_assertion). The signing key / issuer / JWKS come from byos.aws.oidc.
      // Azure fixes the federated-credential audience to a cloud constant, so —
      // like the CN clouds — it needs no env var.
      oidc: {
        audience: 'api://AzureADTokenExchange',
        sessionDurationSec: 3600,
      },
    },
  }
}
