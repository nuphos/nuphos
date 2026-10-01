import { newerRuntimeVersion, stableRuntimeVersion } from './runtime-release'

import type { OpenAbProvider } from './runtime-provider'

import { config } from '@/config'

export const NUPHOS_RUNTIME_REPOSITORY = 'ghcr.io/zeabur/nuphos-runtime'

/** Every managed agent of a provider runs the image a self-hosted agent of it runs. */
export function managedRuntimeImage(provider: OpenAbProvider, requestedVersion?: string): string {
  const configured = config.claudeCodeRuntimeProvisioner.runtimeVersion
  const version =
    stableRuntimeVersion(requestedVersion) && newerRuntimeVersion(requestedVersion, configured)
      ? requestedVersion
      : configured

  return `${NUPHOS_RUNTIME_REPOSITORY}:${version}-${provider}`
}
