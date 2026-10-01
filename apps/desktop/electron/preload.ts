import { contextBridge } from 'electron'

import { agentApi } from './preload-parts/api-agent'
import { appConfigApi } from './preload-parts/api-app-config'
import { awsApi } from './preload-parts/api-aws'
import { cloudAccountsApi } from './preload-parts/api-cloud-accounts'
import { cloudOpsApi } from './preload-parts/api-cloud-ops'
import { cloudflareApi } from './preload-parts/api-cloudflare'
import { connectApi } from './preload-parts/api-connect'
import { databasesApi } from './preload-parts/api-databases'
import { deviceApi } from './preload-parts/api-device'
import { instructionsApi } from './preload-parts/api-instructions'
import { integrationsApi } from './preload-parts/api-integrations'
import { k8sAppApi } from './preload-parts/api-k8s-app'
import { localTerminalApi } from './preload-parts/api-local-terminal'
import { posthogApi } from './preload-parts/api-posthog'
import { teamApi } from './preload-parts/api-team'

const api = {
  ...appConfigApi,
  ...localTerminalApi,
  ...k8sAppApi,
  ...teamApi,
  ...cloudflareApi,
  ...cloudAccountsApi,
  ...databasesApi,
  ...deviceApi,
  ...awsApi,
  ...cloudOpsApi,
  ...agentApi,
  ...integrationsApi,
  ...posthogApi,
  ...connectApi,
  ...instructionsApi,
}

contextBridge.exposeInMainWorld('api', api)

export type API = typeof api
