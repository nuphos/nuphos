import type { BindingShare } from '../lib/bindingShare.ts'
import type { TeamConnectorsBundle } from '../types/app-misc.ts'
import type {
  GithubCliResult,
  GithubCliViewer,
  GithubMergeMethod,
  GithubPRDetail,
  GithubPullRef,
  GithubRefKey,
  GithubRefSummary,
  GithubReviewEvent,
} from '../types/github-pr-detail.ts'
import type {
  LinearIssueDetail,
  LinearTeamIssuesPage,
  LinearTeamSummary,
} from '../types/linear-issue-detail.ts'
import type {
  AsanaAccount,
  AsanaBindResult,
  TrelloBindResult,
  GithubInstallation,
  GithubPR,
  GithubRepository,
  GithubWorkflowRun,
  GitlabBindResult,
  GitlabBinding,
  GitlabBindingNamespaces,
  GitlabMergeRequest,
  GitlabPipeline,
  GitlabProject,
  JiraBindResult,
  JiraSite,
  LinearBindResult,
  LinearWorkspace,
  SentryAccount,
  SentryBindResult,
} from '../types/onprem-git.ts'

export type WindowGitApi = {
  atlasListGithubInstallations(teamId: string): Promise<GithubInstallation[]>
  atlasStartGithubInstall(teamId: string, share?: BindingShare): Promise<GithubInstallation>
  atlasUnbindGithubInstallation(teamId: string, installationId: number): Promise<void>
  atlasListGithubRepositories(teamId: string, installationId: number): Promise<GithubRepository[]>
  atlasListGithubPulls(
    teamId: string,
    installationId: number,
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all',
  ): Promise<GithubPR[]>
  atlasGetGithubPull(
    teamId: string,
    installationId: number,
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<GithubPRDetail>
  githubCliViewer(): Promise<GithubCliViewer | null>
  githubCliRefSummary(ref: GithubRefKey): Promise<GithubRefSummary | null>
  githubCliComment(pull: GithubPullRef, body: string): Promise<GithubCliResult>
  githubCliReview(
    pull: GithubPullRef,
    event: GithubReviewEvent,
    body: string,
  ): Promise<GithubCliResult>
  githubCliMerge(pull: GithubPullRef, method: GithubMergeMethod): Promise<GithubCliResult>
  atlasListGithubActionRuns(
    teamId: string,
    installationId: number,
    owner: string,
    repo: string,
    page: number,
  ): Promise<{ runs: GithubWorkflowRun[]; totalCount: number }>
  atlasListGitlabBindings(teamId: string): Promise<GitlabBinding[]>
  atlasStartGitlabOAuth(
    teamId: string,
    hostUrl: string,
    clientId?: string,
    clientSecret?: string,
    scopes?: string[],
    share?: BindingShare,
  ): Promise<GitlabBindResult>
  atlasCancelGitlabOAuth(teamId: string): Promise<void>
  atlasStartCloudflareConnect(
    teamId: string,
    scopes?: string[],
    share?: BindingShare,
  ): Promise<{
    bindingId: string
    teamId: string
    accountId: string
    accountName: string
  }>
  atlasCancelCloudflareConnect(teamId: string): Promise<void>
  atlasUnbindGitlab(teamId: string, bindingId: string): Promise<void>
  atlasListGitlabNamespaces(teamId: string): Promise<GitlabBindingNamespaces[]>
  atlasListGitlabProjects(
    teamId: string,
    bindingId: string,
    namespaceFullPath?: string,
  ): Promise<GitlabProject[]>
  atlasListGitlabMergeRequests(
    teamId: string,
    bindingId: string,
    projectId: number,
    state: 'opened' | 'closed' | 'merged' | 'all',
  ): Promise<GitlabMergeRequest[]>
  atlasListGitlabPipelines(
    teamId: string,
    bindingId: string,
    projectId: number,
    page: number,
  ): Promise<GitlabPipeline[]>
  atlasListTeamConnectors(teamId: string): Promise<TeamConnectorsBundle>
  atlasListLinearWorkspaces(teamId: string): Promise<LinearWorkspace[]>
  atlasStartLinearOAuth(teamId: string, share?: BindingShare): Promise<LinearBindResult>
  atlasCancelLinearOAuth(teamId: string): Promise<void>
  atlasUnbindLinear(teamId: string, bindingId: string): Promise<void>
  atlasGetLinearIssue(
    teamId: string,
    bindingId: string,
    identifier: string,
  ): Promise<LinearIssueDetail>
  atlasListLinearTeams(teamId: string, bindingId: string): Promise<{ teams: LinearTeamSummary[] }>
  atlasListLinearTeamIssues(
    teamId: string,
    bindingId: string,
    linearTeamId: string,
    cursor?: string,
  ): Promise<LinearTeamIssuesPage>
  atlasListJiraSites(teamId: string): Promise<JiraSite[]>
  atlasStartJiraOAuth(teamId: string, share?: BindingShare): Promise<JiraBindResult>
  atlasCancelJiraOAuth(teamId: string): Promise<void>
  atlasUnbindJira(teamId: string, bindingId: string): Promise<void>
  atlasListAsanaAccounts(teamId: string): Promise<AsanaAccount[]>
  atlasStartAsanaOAuth(teamId: string, share?: BindingShare): Promise<AsanaBindResult>
  atlasStartTrelloOAuth(teamId: string, share?: BindingShare): Promise<TrelloBindResult>
  atlasCancelAsanaOAuth(teamId: string): Promise<void>
  atlasCancelTrelloOAuth(teamId: string): Promise<void>
  atlasUnbindAsana(teamId: string, bindingId: string): Promise<void>
  atlasListSentryAccounts(teamId: string): Promise<SentryAccount[]>
  atlasStartSentryOAuth(teamId: string, share?: BindingShare): Promise<SentryBindResult>
  atlasCancelSentryOAuth(teamId: string): Promise<void>
  atlasUnbindSentry(teamId: string, bindingId: string): Promise<void>
}
