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
  LocalSkillImportResult,
  LocalSkillInfo,
  PastedAttachmentPayload,
} from './app-types.ts'
import type {
  TeamSkillHistory,
  TeamSkillManifest,
  TeamSkillObject,
  TeamSkillObjectDetail,
} from './plan-types.ts'
import type { Diagram, DiagramSummary } from '../architecture/schema.ts'
import type { DashboardViewRange } from '../dashboards/schema'
import type { ConnectAgentLink } from '../lib/connectAgentLink.ts'
import type {
  AtlasTeam,
  AuthStatus,
  ChangelogState,
  UpdaterState,
  UserInfo,
} from '../types/team.ts'

export type WindowAppApi = {
  claimFirstLaunchIntro?(): Promise<boolean>
  authUpdateProfile(input: { name: string; username: string; avatarURL: string }): Promise<UserInfo>
  authStatus(): Promise<AuthStatus>
  authLogin(): Promise<UserInfo>
  authLogout(): Promise<void>
  authCancel(): Promise<void>
  authEmailRequestCode(email: string): Promise<void>
  authEmailVerifyCode(email: string, code: string): Promise<UserInfo>
  analyticsIdentify(userId: string, props?: Record<string, unknown>): Promise<void>
  analyticsSetTeam(teamId: string | null): Promise<void>
  appGetVersion(): Promise<string>
  appSetApiEndpoint(url: string | null): Promise<string>
  appGetPlatform(): Promise<string>
  appSelectAsciiInputSource(): Promise<void>
  appSetNativeTheme(source: 'system' | 'light' | 'dark'): Promise<void>
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
  onAgentFocusSession(cb: (payload: AgentFocusSessionPayload) => void): () => void
  selectLocalFile(): Promise<string[]>
  selectLocalFolder(): Promise<string[]>
  saveTextFile(defaultPath: string, content: string): Promise<{ saved: boolean; path?: string }>
  listLocalAgentSessions(source: LocalSessionSource): Promise<LocalAgentSessionInfo[]>
  getPathForFile(file: File): string
  savePastedAttachments(payload: PastedAttachmentPayload): Promise<string[]>
  updaterGetState(): Promise<UpdaterState>
  updaterCheck(): Promise<UpdaterState>
  updaterInstall(): Promise<void>
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
  dashboardsGenerateInsight(
    teamId: string,
    dashboardId: string,
    panelId: string,
    viewRange?: DashboardViewRange,
  ): Promise<import('../dashboards/schema').DashboardPanelInsight>
  dashboardsInsightFeedback(
    teamId: string,
    dashboardId: string,
    panelId: string,
    rating: 'up' | 'down',
    note?: string,
    viewRange?: DashboardViewRange,
  ): Promise<{ ok: boolean }>
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
  teamSkillsGetManifest(teamId: string): Promise<TeamSkillManifest>
  teamSkillsListObjects(teamId: string): Promise<{ scope: string; objects: TeamSkillObject[] }>
  teamSkillsGetObject(teamId: string, key: string): Promise<TeamSkillObjectDetail>
  teamSkillsGetHistory(teamId: string, name: string): Promise<TeamSkillHistory>
  teamSkillsPutObject(
    teamId: string,
    key: string,
    file: { filename: string; bytes: Uint8Array; contentType?: string },
  ): Promise<TeamSkillObject>
  teamSkillsListLocal(): Promise<LocalSkillInfo[]>
  teamSkillsImportLocal(teamId: string, skillId: string): Promise<LocalSkillImportResult>
  teamSkillsDeleteObject(teamId: string, key: string): Promise<void>
  teamSkillsDeleteSkill(
    teamId: string,
    name: string,
  ): Promise<{ name: string; deletedCount: number; keys: string[] }>
}
