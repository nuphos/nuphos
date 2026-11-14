import type {
  AgentChatDeepLinkPayload,
  AgentChatSkillId,
  AgentChatSkillInstallResult,
  AgentChatSkillStatus,
  AgentChatSkillTarget,
  AgentChatSkillUninstallResult,
  AgentFocusSessionPayload,
  AppOpenDeepLinkPayload,
  LocalAgentSessionInfo,
  LocalSessionSource,
  LocalSkillImportOutcome,
  LocalSetupResult,
  LocalSetupStatus,
  LocalSkillInfo,
  PastedAttachmentPayload,
} from './app-types.ts'
import type { LoginItemState } from './device-types.ts'
import type {
  GithubSkillCandidate,
  GithubSkillPreview,
  GithubSkillUpdate,
  SkillScope,
  TeamSkillHistory,
  TeamSkillManifest,
  TeamSkillObject,
  TeamSkillObjectDetail,
} from './plan-types.ts'
import type { Diagram, DiagramSummary } from '../architecture/schema.ts'
import type { DashboardViewRange } from '../dashboards/schema'
import type { Design, DesignOp, DesignPage, DesignSummary } from '../design/schema.ts'
import type { ConnectAgentLink } from '../lib/connectAgentLink.ts'
import type {
  AccountSummary,
  AtlasTeam,
  AuthStatus,
  ChangelogState,
  PersonalCredential,
  PersonalCredentialDeepLinkPayload,
  PersonalCredentialProvider,
  MfaSetup,
  MfaStatus,
  SignInSession,
  SocialProvider,
  UpdaterState,
  UserInfo,
} from '../types/team.ts'
import type { SocialOption } from '../types/app-misc.ts'

export type WindowAppApi = {
  claimFirstLaunchIntro?(): Promise<boolean>
  authUpdateProfile(input: { name: string; username: string; avatarURL: string }): Promise<UserInfo>
  atlasListPersonalCredentials(): Promise<PersonalCredential[]>
  atlasStartPersonalCredential(
    provider: PersonalCredentialProvider,
    teamId?: string,
  ): Promise<{ authorizeUrl: string; state: string }>
  atlasDeletePersonalCredential(
    provider: PersonalCredentialProvider,
    teamId?: string,
  ): Promise<void>
  atlasListSignInSessions(): Promise<SignInSession[]>
  atlasSignOutSession(id: string): Promise<void>
  atlasSignOutOtherSessions(): Promise<number>
  authMfaVerify(mfaToken: string, code: string): Promise<UserInfo>
  atlasGetMfaStatus(): Promise<MfaStatus>
  atlasStartMfaSetup(): Promise<MfaSetup>
  atlasConfirmMfaSetup(code: string): Promise<string[]>
  atlasNewMfaRecoveryCodes(code: string): Promise<string[]>
  atlasDisableMfa(code: string): Promise<void>
  atlasReauthMfa(code: string): Promise<void>
  authMfaVerifyPasskey(mfaToken: string): Promise<UserInfo>
  atlasReauthWithPasskey(): Promise<void>
  atlasAddPasskey(): Promise<void>
  atlasRemovePasskey(id: string, code: string): Promise<void>
  authUploadAvatar(image: Uint8Array): Promise<UserInfo>
  apiUrlSync(): string
  authRemoveAvatar(): Promise<UserInfo>
  authStatus(): Promise<AuthStatus>
  authSocialProviders(): Promise<SocialOption[]>
  authLogin(provider: SocialProvider): Promise<UserInfo>
  authLogout(): Promise<void>
  authCancel(): Promise<void>
  authListAccounts(): Promise<AccountSummary[]>
  authSwitchAccount(key: string): Promise<'switched' | 'signInAgain'>
  authSignOutAccount(key: string): Promise<void>
  authSignOutAllAccounts(): Promise<void>
  authEmailRequestCode(email: string): Promise<void>
  authEmailVerifyCode(email: string, code: string): Promise<UserInfo>
  analyticsIdentify(userId: string, props?: Record<string, unknown>): Promise<void>
  analyticsSetTeam(teamId: string | null): Promise<void>
  sendDiagnostics(): boolean
  setSendDiagnostics(send: boolean): Promise<boolean>
  onSendDiagnosticsChanged(listener: (send: boolean) => void): () => void
  appGetVersion(): Promise<string>
  appSetApiEndpoint(url: string | null): Promise<string>
  appGetPlatform(): Promise<string>
  appSelectAsciiInputSource(): Promise<void>
  /** The menu bar and notifications follow the language the windows show. */
  appSetLocale(locale: string): Promise<void>
  appSetNativeTheme(source: 'system' | 'light' | 'dark'): Promise<void>
  appGetAppIcon(): Promise<string>
  appSetAppIcon(icon: string): Promise<void>
  appGetLoginItem(): Promise<LoginItemState>
  appSetLoginItem(openAtLogin: boolean): Promise<LoginItemState>
  onNativeThemeUpdated(cb: (payload: { shouldUseDarkColors: boolean }) => void): () => void
  getZoomFactor(): number
  notifyZoom(): void
  appHideWindow(): Promise<void>
  listAgentChatSkills(): Promise<AgentChatSkillStatus[]>
  installAgentChatSkill(
    target: AgentChatSkillTarget,
    skillId: AgentChatSkillId,
  ): Promise<AgentChatSkillInstallResult>
  uninstallAgentChatSkill(
    target: AgentChatSkillTarget,
    skillId: AgentChatSkillId,
  ): Promise<AgentChatSkillUninstallResult>
  openAgentChatSkillsFolder(target: AgentChatSkillTarget): Promise<void>
  onAgentChatDeepLink(cb: (payload: AgentChatDeepLinkPayload) => void): () => void
  onAppOpenDeepLink(cb: (payload: AppOpenDeepLinkPayload) => void): () => void
  onConnectAgentDeepLink(cb: (payload: ConnectAgentLink) => void): () => void
  onConnectorStaleDeepLink(cb: (payload: { name: string }) => void): () => void
  onWebUrlDeepLink(cb: (url: string) => void): () => void
  onPersonalCredentialDeepLink(cb: (payload: PersonalCredentialDeepLinkPayload) => void): () => void
  onAgentFocusSession(cb: (payload: AgentFocusSessionPayload) => void): () => void
  selectLocalFile(): Promise<string[]>
  selectLocalFolder(): Promise<string[]>
  saveTextFile(defaultPath: string, content: string): Promise<{ saved: boolean; path?: string }>
  listLocalAgentSessions(source: LocalSessionSource): Promise<LocalAgentSessionInfo[]>
  getPathForFile(file: File): string
  savePastedAttachments(payload: PastedAttachmentPayload): Promise<string[]>
  updaterGetState(): Promise<UpdaterState>
  updaterCheck(): Promise<void>
  updaterInstall(): Promise<void>
  updaterGetAutoInstall(): Promise<{ enabled: boolean }>
  updaterSetAutoInstall(enabled: boolean): Promise<{ enabled: boolean }>
  onUpdaterStatus(cb: (state: UpdaterState) => void): () => void
  changelogGetState(): Promise<ChangelogState>
  onChangelogStatus(cb: (state: ChangelogState) => void): () => void
  atlasListTeams(): Promise<AtlasTeam[]>
  archListDiagrams(teamId: string): Promise<DiagramSummary[]>
  archGetDiagram(teamId: string, diagramId: string): Promise<Diagram>
  archCreateDiagram(teamId: string, name: string): Promise<Diagram>
  archSaveDiagram(
    teamId: string,
    diagramId: string,
    patch: { name?: string; nodes?: Diagram['nodes']; views?: Diagram['views'] },
  ): Promise<Diagram>
  archDeleteDiagram(teamId: string, diagramId: string): Promise<void>
  designsList(teamId: string): Promise<DesignSummary[]>
  designsStamp(teamId: string, designId: string): Promise<{ updatedAt: string }>
  designsGet(teamId: string, designId: string): Promise<Design>
  designsCreate(teamId: string, input: { name?: string; pages?: DesignPage[] }): Promise<Design>
  designsReplace(
    teamId: string,
    designId: string,
    /** Replacing `pages` needs the `updatedAt` last read; a mismatch is a 409. */
    patch: { name?: string; pages?: DesignPage[]; updatedAt?: string },
  ): Promise<Design>
  designsApplyOps(teamId: string, designId: string, ops: DesignOp[]): Promise<Design>
  designsDelete(teamId: string, designId: string): Promise<void>
  dashboardsList(teamId: string): Promise<import('../dashboards/schema').NuphosDashboard[]>
  dashboardsCreate(
    teamId: string,
    input: import('../dashboards/schema').CreateDashboardInput,
  ): Promise<import('../dashboards/schema').NuphosDashboard>
  dashboardsGet(
    teamId: string,
    dashboardId: string,
    viewRange?: DashboardViewRange,
  ): Promise<import('../dashboards/schema').NuphosDashboardDetail>
  dashboardsUpdate(
    teamId: string,
    dashboardId: string,
    input: import('../dashboards/schema').UpdateDashboardInput,
  ): Promise<import('../dashboards/schema').NuphosDashboard>
  dashboardsDelete(teamId: string, dashboardId: string): Promise<void>
  dashboardsRefresh(
    teamId: string,
    dashboardId: string,
    force?: boolean,
    viewRange?: DashboardViewRange,
  ): Promise<{ snapshots: import('../dashboards/schema').DashboardPanelSnapshot[] }>
  dashboardsCreatePanel(
    teamId: string,
    dashboardId: string,
    input: import('../dashboards/schema').CreatePanelInput,
  ): Promise<import('../dashboards/schema').DashboardPanel>
  dashboardsUpdatePanel(
    teamId: string,
    dashboardId: string,
    panelId: string,
    input: import('../dashboards/schema').UpdatePanelInput,
  ): Promise<import('../dashboards/schema').DashboardPanel>
  dashboardsDeletePanel(teamId: string, dashboardId: string, panelId: string): Promise<void>
  dashboardsExecutePanel(
    teamId: string,
    dashboardId: string,
    panelId: string,
    force?: boolean,
    viewRange?: DashboardViewRange,
  ): Promise<import('../dashboards/schema').DashboardPanelSnapshot>
  dashboardsGetAlert(
    teamId: string,
    dashboardId: string,
    panelId: string,
  ): Promise<{ alert: import('../dashboards/schema').DashboardPanelAlert | null }>
  dashboardsSaveAlert(
    teamId: string,
    dashboardId: string,
    panelId: string,
    input: import('../dashboards/schema').DashboardPanelAlertInput,
  ): Promise<import('../dashboards/schema').DashboardPanelAlert>
  dashboardsDeleteAlert(
    teamId: string,
    dashboardId: string,
    panelId: string,
  ): Promise<{ ok: boolean }>
  teamSkillsGetManifest(teamId: string, scope?: SkillScope): Promise<TeamSkillManifest>
  teamSkillsListObjects(
    teamId: string,
    scope?: SkillScope,
  ): Promise<{ scope: string; objects: TeamSkillObject[] }>
  teamSkillsGetObject(
    teamId: string,
    key: string,
    scope?: SkillScope,
  ): Promise<TeamSkillObjectDetail>
  teamSkillsGetHistory(teamId: string, name: string, scope?: SkillScope): Promise<TeamSkillHistory>
  teamSkillsPutObject(
    teamId: string,
    key: string,
    file: { filename: string; bytes: Uint8Array; contentType?: string },
    scope?: SkillScope,
  ): Promise<TeamSkillObject>
  teamSkillsListLocal(): Promise<LocalSkillInfo[]>
  voiceTranscribe(
    teamId: string,
    file: { filename: string; bytes: Uint8Array; contentType?: string },
    prompt?: string,
  ): Promise<{ text: string; language: string | null }>
  localSetupStatus(teamId: string): Promise<LocalSetupStatus>
  localSetupSync(teamId: string): Promise<LocalSetupResult>
  localSetupApproveLinks(
    teamId: string,
    name: string,
    reviewed: { relPath: string; realPath: string }[],
  ): Promise<LocalSetupResult>
  localSetupSetAutoSync(teamId: string, enabled: boolean): Promise<void>
  localSetupSetFolders(teamId: string, folders: string[]): Promise<LocalSetupResult>
  localSetupSources(teamId: string): Promise<Record<string, string>>
  teamSkillsImportLocal(
    teamId: string,
    scope: SkillScope | undefined,
    picks: { id: string; reviewed: { relPath: string; realPath: string }[] }[],
  ): Promise<LocalSkillImportOutcome[]>
  teamSkillsDeleteObject(teamId: string, key: string, scope?: SkillScope): Promise<void>
  teamSkillsDeleteSkill(
    teamId: string,
    name: string,
    scope?: SkillScope,
  ): Promise<{ name: string; deletedCount: number; keys: string[] }>
  teamSkillsPromote(teamId: string, name: string): Promise<unknown>
  teamSkillsGithubUpdates(
    teamId: string,
    scope?: SkillScope,
  ): Promise<{ updates: GithubSkillUpdate[] }>
  teamSkillsGithubUpdate(
    teamId: string,
    input: { names: string[]; overwriteEdited: string[]; commits: Record<string, string> },
    scope?: SkillScope,
  ): Promise<{ updated: GithubSkillUpdate[] }>
  teamSkillsGithubPreview(
    teamId: string,
    source: string,
    scope?: SkillScope,
  ): Promise<GithubSkillPreview>
  teamSkillsGithubInstall(
    teamId: string,
    input: { source: string; commitSha: string; names: string[] },
    scope?: SkillScope,
  ): Promise<{ installed: GithubSkillCandidate[] }>
}
