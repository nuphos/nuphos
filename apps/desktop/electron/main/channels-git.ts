import * as asanaInstall from '../asana-install'
import * as atlas from '../atlas'
import * as cloudflareInstall from '../cloudflare-install'
import * as githubCli from '../github-cli'
import * as githubInstall from '../github-install'
import * as gitlabInstall from '../gitlab-install'
import * as jiraInstall from '../jira-install'
import * as linearInstall from '../linear-install'
import * as sentryInstall from '../sentry-install'

import type {
  GithubMergeMethod,
  GithubPullRef,
  GithubReviewEvent,
} from '../../src/types/github-pr-detail.ts'
import type { IpcMainInvokeEvent } from 'electron'

export const gitChannels = {
  'atlas:listOnpremClusters': (_e: unknown, teamId: string) => atlas.listOnpremClusters(teamId),
  'atlas:enrolOnpremCluster': (_e: unknown, teamId: string, label: string, kubeconfig?: string) =>
    atlas.enrolOnpremCluster(teamId, label, kubeconfig),
  'atlas:onpremClusterConnection': (_e: unknown, teamId: string, clusterId: string) =>
    atlas.onpremClusterConnection(teamId, clusterId),
  'atlas:onpremClusterAccess': (_e: unknown, teamId: string, clusterId: string) =>
    atlas.onpremClusterAccess(teamId, clusterId),
  'atlas:setOnpremClusterKubeconfig': (
    _e: unknown,
    teamId: string,
    clusterId: string,
    kubeconfig: string,
  ) => atlas.setOnpremClusterKubeconfig(teamId, clusterId, kubeconfig),
  'atlas:rotateOnpremClusterToken': (_e: unknown, teamId: string, clusterId: string) =>
    atlas.rotateOnpremClusterToken(teamId, clusterId),
  'atlas:deleteOnpremCluster': (_e: unknown, teamId: string, clusterId: string) =>
    atlas.deleteOnpremCluster(teamId, clusterId),
  'atlas:listGrafanaInstances': (_e: unknown, teamId: string) => atlas.listGrafanaInstances(teamId),
  'atlas:bindGrafanaInstance': (
    _e: unknown,
    teamId: string,
    name: string,
    grafanaUrl: string,
    saToken: string,
  ) => atlas.bindGrafanaInstance(teamId, name, grafanaUrl, saToken),
  'atlas:unbindGrafanaInstance': (_e: unknown, teamId: string, instanceId: string) =>
    atlas.unbindGrafanaInstance(teamId, instanceId),
  'atlas:grafanaProxy': (
    _e: unknown,
    teamId: string,
    instanceId: string,
    method: string,
    path: string,
    body?: unknown,
  ) => atlas.grafanaProxy(teamId, instanceId, method, path, body),
  'atlas:listGithubInstallations': (_e: unknown, teamId: string) =>
    atlas.listGithubInstallations(teamId),
  'atlas:startGithubInstall': (_e: unknown, teamId: string) => githubInstall.startInstall(teamId),
  'atlas:unbindGithubInstallation': (_e: unknown, teamId: string, installationId: number) =>
    atlas.unbindGithubInstallation(teamId, installationId),
  'atlas:listGithubRepositories': (_e: unknown, teamId: string, installationId: number) =>
    atlas.listGithubRepositories(teamId, installationId),
  'atlas:listGithubPulls': (
    _e: unknown,
    teamId: string,
    installationId: number,
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all',
  ) => atlas.listGithubPulls(teamId, installationId, owner, repo, state),
  'atlas:getGithubPull': (
    _e: unknown,
    teamId: string,
    installationId: number,
    owner: string,
    repo: string,
    pullNumber: number,
  ) => atlas.getGithubPull(teamId, installationId, owner, repo, pullNumber),
  'github-cli:viewer': () => githubCli.githubCliViewer(),
  'github-cli:comment': (_e: unknown, pull: GithubPullRef, body: string) =>
    githubCli.githubCliComment(pull, body),
  'github-cli:review': (_e: unknown, pull: GithubPullRef, event: GithubReviewEvent, body: string) =>
    githubCli.githubCliReview(pull, event, body),
  'github-cli:merge': (
    e: IpcMainInvokeEvent,
    pull: GithubPullRef,
    method: GithubMergeMethod,
    headSha: string,
  ) => githubCli.githubCliMerge(e.sender, pull, method, headSha),
  'atlas:listGithubActionRuns': (
    _e: unknown,
    teamId: string,
    installationId: number,
    owner: string,
    repo: string,
    page: number,
  ) => atlas.listGithubActionRuns(teamId, installationId, owner, repo, page),
  'atlas:listGitlabBindings': (_e: unknown, teamId: string) => atlas.listGitlabBindings(teamId),
  'atlas:startGitlabOAuth': (
    _e: unknown,
    teamId: string,
    hostUrl: string,
    clientId?: string,
    clientSecret?: string,
    scopes?: string[],
  ) => gitlabInstall.startInstall(teamId, hostUrl, clientId, clientSecret, scopes),
  'atlas:cancelGitlabOAuth': (_e: unknown, teamId: string) => gitlabInstall.cancelPending(teamId),
  'atlas:startCloudflareConnect': (_e: unknown, teamId: string, scopes?: string[]) =>
    cloudflareInstall.startInstall(teamId, scopes),
  'atlas:cancelCloudflareConnect': (_e: unknown, teamId: string) =>
    cloudflareInstall.cancelPending(teamId),
  'atlas:unbindGitlab': (_e: unknown, teamId: string, bindingId: string) =>
    atlas.unbindGitlab(teamId, bindingId),
  'atlas:listGitlabNamespaces': (_e: unknown, teamId: string) => atlas.listGitlabNamespaces(teamId),
  'atlas:listGitlabProjects': (
    _e: unknown,
    teamId: string,
    bindingId: string,
    namespaceFullPath?: string,
  ) => atlas.listGitlabProjects(teamId, bindingId, namespaceFullPath),
  'atlas:listGitlabMergeRequests': (
    _e: unknown,
    teamId: string,
    bindingId: string,
    projectId: number,
    state: 'opened' | 'closed' | 'merged' | 'all',
  ) => atlas.listGitlabMergeRequests(teamId, bindingId, projectId, state),
  'atlas:listGitlabPipelines': (
    _e: unknown,
    teamId: string,
    bindingId: string,
    projectId: number,
    page: number,
  ) => atlas.listGitlabPipelines(teamId, bindingId, projectId, page),
  'atlas:listTeamConnectors': (_e: unknown, teamId: string) => atlas.listTeamConnectors(teamId),
  'atlas:listLinearWorkspaces': (_e: unknown, teamId: string) => atlas.listLinearWorkspaces(teamId),
  'atlas:startLinearOAuth': (_e: unknown, teamId: string) => linearInstall.startInstall(teamId),
  'atlas:cancelLinearOAuth': (_e: unknown, teamId: string) => linearInstall.cancelPending(teamId),
  'atlas:unbindLinear': (_e: unknown, teamId: string, bindingId: string) =>
    atlas.unbindLinear(teamId, bindingId),
  'atlas:getLinearIssue': (_e: unknown, teamId: string, bindingId: string, identifier: string) =>
    atlas.getLinearIssue(teamId, bindingId, identifier),
  'atlas:listLinearTeams': (_e: unknown, teamId: string, bindingId: string) =>
    atlas.listLinearTeams(teamId, bindingId),
  'atlas:listLinearTeamIssues': (
    _e: unknown,
    teamId: string,
    bindingId: string,
    linearTeamId: string,
    cursor?: string,
  ) => atlas.listLinearTeamIssues(teamId, bindingId, linearTeamId, cursor),
  'atlas:listJiraSites': (_e: unknown, teamId: string) => atlas.listJiraSites(teamId),
  'atlas:startJiraOAuth': (_e: unknown, teamId: string) => jiraInstall.startInstall(teamId),
  'atlas:cancelJiraOAuth': (_e: unknown, teamId: string) => jiraInstall.cancelPending(teamId),
  'atlas:unbindJira': (_e: unknown, teamId: string, bindingId: string) =>
    atlas.unbindJira(teamId, bindingId),
  'atlas:listAsanaAccounts': (_e: unknown, teamId: string) => atlas.listAsanaAccounts(teamId),
  'atlas:startAsanaOAuth': (_e: unknown, teamId: string) => asanaInstall.startInstall(teamId),
  'atlas:cancelAsanaOAuth': (_e: unknown, teamId: string) => asanaInstall.cancelPending(teamId),
  'atlas:unbindAsana': (_e: unknown, teamId: string, bindingId: string) =>
    atlas.unbindAsana(teamId, bindingId),
  'atlas:listSentryAccounts': (_e: unknown, teamId: string) => atlas.listSentryAccounts(teamId),
  'atlas:startSentryOAuth': (_e: unknown, teamId: string) => sentryInstall.startInstall(teamId),
  'atlas:cancelSentryOAuth': (_e: unknown, teamId: string) => sentryInstall.cancelPending(teamId),
  'atlas:unbindSentry': (_e: unknown, teamId: string, bindingId: string) =>
    atlas.unbindSentry(teamId, bindingId),
} as const
