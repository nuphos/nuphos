import type { BindingShare } from '../lib/bindingShare.ts'
import type {
  GithubMergeMethod,
  GithubPullRef,
  GithubRefKey,
  GithubReviewEvent,
} from '../types/github-pr-detail.ts'

export const gitApi = {
  atlasListGithubInstallations: (teamId: string) => window.api.atlasListGithubInstallations(teamId),
  atlasStartGithubInstall: (teamId: string, share?: BindingShare) =>
    window.api.atlasStartGithubInstall(teamId, share),
  atlasUnbindGithubInstallation: (teamId: string, installationId: number) =>
    window.api.atlasUnbindGithubInstallation(teamId, installationId),
  atlasListGithubRepositories: (teamId: string, installationId: number) =>
    window.api.atlasListGithubRepositories(teamId, installationId),
  atlasListGithubPulls: (
    teamId: string,
    installationId: number,
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all',
  ) => window.api.atlasListGithubPulls(teamId, installationId, owner, repo, state),
  atlasGetGithubPull: (
    teamId: string,
    installationId: number,
    owner: string,
    repo: string,
    pullNumber: number,
  ) => window.api.atlasGetGithubPull(teamId, installationId, owner, repo, pullNumber),
  githubCliViewer: () => window.api.githubCliViewer(),
  githubCliRefSummary: (ref: GithubRefKey) => window.api.githubCliRefSummary(ref),
  githubCliComment: (pull: GithubPullRef, body: string) => window.api.githubCliComment(pull, body),
  githubCliReview: (pull: GithubPullRef, event: GithubReviewEvent, body: string) =>
    window.api.githubCliReview(pull, event, body),
  githubCliMerge: (pull: GithubPullRef, method: GithubMergeMethod) =>
    window.api.githubCliMerge(pull, method),
  atlasListGithubActionRuns: (
    teamId: string,
    installationId: number,
    owner: string,
    repo: string,
    page: number,
  ) => window.api.atlasListGithubActionRuns(teamId, installationId, owner, repo, page),
  atlasListGitlabBindings: (teamId: string) => window.api.atlasListGitlabBindings(teamId),
  atlasStartGitlabOAuth: (
    teamId: string,
    hostUrl: string,
    clientId?: string,
    clientSecret?: string,
    scopes?: string[],
    share?: BindingShare,
  ) => window.api.atlasStartGitlabOAuth(teamId, hostUrl, clientId, clientSecret, scopes, share),
  atlasCancelGitlabOAuth: (teamId: string) => window.api.atlasCancelGitlabOAuth(teamId),
  atlasStartCloudflareConnect: (teamId: string, scopes?: string[], share?: BindingShare) =>
    window.api.atlasStartCloudflareConnect(teamId, scopes, share),
  atlasCancelCloudflareConnect: (teamId: string) => window.api.atlasCancelCloudflareConnect(teamId),
  atlasUnbindGitlab: (teamId: string, bindingId: string) =>
    window.api.atlasUnbindGitlab(teamId, bindingId),
  atlasListGitlabNamespaces: (teamId: string) => window.api.atlasListGitlabNamespaces(teamId),
  atlasListGitlabProjects: (teamId: string, bindingId: string, namespaceFullPath?: string) =>
    window.api.atlasListGitlabProjects(teamId, bindingId, namespaceFullPath),
  atlasListGitlabMergeRequests: (
    teamId: string,
    bindingId: string,
    projectId: number,
    state: 'opened' | 'closed' | 'merged' | 'all',
  ) => window.api.atlasListGitlabMergeRequests(teamId, bindingId, projectId, state),
  atlasListGitlabPipelines: (teamId: string, bindingId: string, projectId: number, page: number) =>
    window.api.atlasListGitlabPipelines(teamId, bindingId, projectId, page),
  atlasListTeamConnectors: (teamId: string) => window.api.atlasListTeamConnectors(teamId),
  atlasListLinearWorkspaces: (teamId: string) => window.api.atlasListLinearWorkspaces(teamId),
  atlasStartLinearOAuth: (teamId: string, share?: BindingShare) =>
    window.api.atlasStartLinearOAuth(teamId, share),
  atlasCancelLinearOAuth: (teamId: string) => window.api.atlasCancelLinearOAuth(teamId),
  atlasUnbindLinear: (teamId: string, bindingId: string) =>
    window.api.atlasUnbindLinear(teamId, bindingId),
  atlasGetLinearIssue: (teamId: string, bindingId: string, identifier: string) =>
    window.api.atlasGetLinearIssue(teamId, bindingId, identifier),
  atlasListLinearTeams: (teamId: string, bindingId: string) =>
    window.api.atlasListLinearTeams(teamId, bindingId),
  atlasListLinearTeamIssues: (
    teamId: string,
    bindingId: string,
    linearTeamId: string,
    cursor?: string,
  ) => window.api.atlasListLinearTeamIssues(teamId, bindingId, linearTeamId, cursor),
  atlasListJiraSites: (teamId: string) => window.api.atlasListJiraSites(teamId),
  atlasStartJiraOAuth: (teamId: string, share?: BindingShare) =>
    window.api.atlasStartJiraOAuth(teamId, share),
  atlasCancelJiraOAuth: (teamId: string) => window.api.atlasCancelJiraOAuth(teamId),
  atlasUnbindJira: (teamId: string, bindingId: string) =>
    window.api.atlasUnbindJira(teamId, bindingId),
  atlasListAsanaAccounts: (teamId: string) => window.api.atlasListAsanaAccounts(teamId),
  atlasStartAsanaOAuth: (teamId: string, share?: BindingShare) =>
    window.api.atlasStartAsanaOAuth(teamId, share),
  atlasStartTrelloOAuth: (teamId: string, share?: BindingShare) =>
    window.api.atlasStartTrelloOAuth(teamId, share),
  atlasCancelAsanaOAuth: (teamId: string) => window.api.atlasCancelAsanaOAuth(teamId),
  atlasCancelTrelloOAuth: (teamId: string) => window.api.atlasCancelTrelloOAuth(teamId),
  atlasUnbindAsana: (teamId: string, bindingId: string) =>
    window.api.atlasUnbindAsana(teamId, bindingId),
  atlasListSentryAccounts: (teamId: string) => window.api.atlasListSentryAccounts(teamId),
  atlasStartSentryOAuth: (teamId: string, share?: BindingShare) =>
    window.api.atlasStartSentryOAuth(teamId, share),
  atlasCancelSentryOAuth: (teamId: string) => window.api.atlasCancelSentryOAuth(teamId),
  atlasUnbindSentry: (teamId: string, bindingId: string) =>
    window.api.atlasUnbindSentry(teamId, bindingId),
}
