import { config } from '@/config'

import { inClusterKubeClient, kubectlKubeClient } from './kube-client'

import type { KubeClient } from './kube-client'

/** The client the provisioner itself runs with: in-cluster when there is a
 *  ServiceAccount, the operator's kubectl in dev, otherwise none. */
export function provisionerKubeClient(): KubeClient | null {
  return (
    inClusterKubeClient() ??
    (config.claudeCodeRuntimeProvisioner.kubectl ? kubectlKubeClient() : null)
  )
}
