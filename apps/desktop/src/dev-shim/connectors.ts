/* eslint-disable @typescript-eslint/no-explicit-any */
import { call, empty, noop } from './http.ts'

export function connectorsMethods(): Record<string, any> {
  return {
    atlasListTeamConnectors: (teamId: string) => call('GET', `/teams/${teamId}/connectors`),
    atlasListSonarqubeIntegrations: (teamId: string) =>
      call('GET', `/teams/${teamId}/sonarqube-integrations`).then((d: any) => d.integrations ?? []),
    atlasListSonarqubeProjects: (teamId: string, integrationId: string, page = 1, pageSize = 5) =>
      call(
        'GET',
        `/teams/${teamId}/sonarqube-integrations/${integrationId}/projects?page=${String(page)}&pageSize=${String(pageSize)}`,
      ),
    atlasBindSonarqubeIntegration: (
      teamId: string,
      label: string,
      baseUrl: string,
      token: string,
    ) => call('POST', `/teams/${teamId}/sonarqube-integrations`, { label, baseUrl, token }),
    atlasUnbindSonarqubeIntegration: (teamId: string, integrationId: string) =>
      call('DELETE', `/teams/${teamId}/sonarqube-integrations/${integrationId}`),
    atlasListPosthogIntegrations: (teamId: string) =>
      call('GET', `/teams/${teamId}/posthog-integrations`).then((d: any) => d.integrations ?? []),
    atlasGetPosthogScopeCatalog: (teamId: string) =>
      call('GET', `/teams/${teamId}/posthog-integrations/scope-catalog`),
    atlasStartPosthogOAuth: () =>
      Promise.reject(
        new Error('PostHog OAuth is only available in the Electron app (deep link required).'),
      ),
    atlasCancelPosthogOAuth: noop,
    atlasUnbindPosthogIntegration: (teamId: string, integrationId: string) =>
      call('DELETE', `/teams/${teamId}/posthog-integrations/${integrationId}`),
    atlasListPosthogAvailableProjects: (teamId: string, integrationId: string) =>
      call('GET', `/teams/${teamId}/posthog-integrations/${integrationId}/available-projects`).then(
        (d: any) => d.projects ?? [],
      ),
    atlasUpdatePosthogProjects: (teamId: string, integrationId: string, projectIds: number[]) =>
      call('PUT', `/teams/${teamId}/posthog-integrations/${integrationId}/projects`, {
        projectIds,
      }),
    atlasGetPosthogIntegrationAccess: (teamId: string, integrationId: string) =>
      call('GET', `/teams/${teamId}/posthog-integrations/${integrationId}/access`),
    atlasUpdatePosthogIntegrationAccess: (teamId: string, integrationId: string, access: unknown) =>
      call('PUT', `/teams/${teamId}/posthog-integrations/${integrationId}/access`, access),
    atlasListGrafanaInstances: (teamId: string) =>
      call('GET', `/teams/${teamId}/grafana-instances`).then((d: any) => {
        if (Array.isArray(d)) return d

        return d.instances ?? []
      }),
    atlasBindGrafanaInstance: (teamId: string, name: string, grafanaUrl: string, saToken: string) =>
      call('POST', `/teams/${teamId}/grafana-instances`, {
        name,
        grafanaUrl,
        saToken,
      }),
    atlasUnbindGrafanaInstance: (teamId: string, instanceId: string) =>
      call('DELETE', `/teams/${teamId}/grafana-instances/${instanceId}`),
    atlasGrafanaProxy: (
      teamId: string,
      instanceId: string,
      method: string,
      path: string,
      body?: unknown,
    ) => {
      const clean = path.startsWith('/') ? path.slice(1) : path

      return call(method, `/teams/${teamId}/grafana-instances/${instanceId}/proxy/${clean}`, body)
    },
    atlasListGithubInstallations: (teamId: string) =>
      call('GET', `/teams/${teamId}/github-installations`).then((d: any) => {
        if (Array.isArray(d)) return d

        return d.installations ?? []
      }),
    // Browser dev shim cannot launch a deep-link install flow — surface a clear
    // error so the UI can fall back to a manual installation_id input if it
    // ever needs to. The Electron build uses the real protocol-handler path.
    atlasStartGithubInstall: () =>
      Promise.reject(
        new Error(
          'GitHub App install flow is only available in the Electron app (deep link required).',
        ),
      ),
    // Cloudflare Connect OAuth — needs the nuphos:// deep-link round-trip.
    atlasStartCloudflareConnect: () =>
      Promise.reject(
        new Error(
          'Cloudflare OAuth flow is only available in the Electron app (deep link required).',
        ),
      ),
    atlasCancelCloudflareConnect: noop,
    // Architecture diagrams — Electron-only IPC; stub so web dev doesn't crash.
    archListDiagrams: () => empty([] as any),
    archGetDiagram: () =>
      Promise.reject(new Error('Architecture diagrams are only available in the Electron app.')),
    archCreateDiagram: () =>
      Promise.reject(new Error('Architecture diagrams are only available in the Electron app.')),
    archSaveDiagram: noop,
    archDeleteDiagram: noop,
    atlasUnbindGithubInstallation: (teamId: string, installationId: number) =>
      call('DELETE', `/teams/${teamId}/github-installations/${String(installationId)}`),
    atlasListGithubRepositories: (teamId: string, installationId: number) =>
      call(
        'GET',
        `/teams/${teamId}/github-installations/${String(installationId)}/repositories`,
      ).then((d: any) => d.repositories ?? []),
    atlasListGithubPulls: () => empty([]),
    atlasGetGithubPull: () => empty(null),
    atlasListGithubActionRuns: () => empty({ runs: [], totalCount: 0 }),
  }
}
