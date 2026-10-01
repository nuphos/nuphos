// The backend's single source of truth for environment variables. The value
// each key takes — and the comment explaining it — lives in one of the section
// modules under `src/config/`; this file only composes them into the `config`
// object every other module imports. Nothing outside `src/config.ts` and
// `src/config/` may read process.env (config.env-sync.test.ts enforces both
// that and .env.example staying in sync with the sections).

import { agentConfig } from './config/agent'
import { byosCloudConfig } from './config/byos-cloud'
import { byosIntegrationsConfig } from './config/byos-integrations'
import {
  claudeCodePreviewConfig,
  claudeCodeRuntimeProvisionerConfig,
} from './config/claude-code-preview'
import { coreConfig } from './config/core'
import { dashboardsConfig } from './config/dashboards'
import { messagingConfig } from './config/messaging'
import { otelConfig } from './config/otel'
import { platformConfig } from './config/platform'
import { providerBillingConfig } from './config/provider-billing'
import { storageConfig } from './config/storage'

export const config = {
  ...providerBillingConfig(),
  ...coreConfig(),
  ...platformConfig(),
  ...messagingConfig(),
  // Split across two modules purely for size: the cloud half is the federated
  // credential machinery, the integrations half is the per-team SaaS keys.
  byos: {
    ...byosCloudConfig(),
    ...byosIntegrationsConfig(),
  },
  otel: otelConfig(),
  ...storageConfig(),
  agent: agentConfig(),
  claudeCodePreview: claudeCodePreviewConfig(),
  claudeCodeRuntimeProvisioner: claudeCodeRuntimeProvisionerConfig(),
  dashboards: dashboardsConfig(),
}
