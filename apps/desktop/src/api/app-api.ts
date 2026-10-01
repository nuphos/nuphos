import type {
  AgentChatDeepLinkPayload,
  AgentChatSkillId,
  AgentChatSkillTarget,
  AgentFocusSessionPayload,
  AppOpenDeepLinkPayload,
  LocalSessionSource,
  PastedAttachmentPayload,
} from './app-types.ts'
import type { Diagram } from '../architecture/schema.ts'
import type { DashboardViewRange } from '../dashboards/schema'
import type { ConnectAgentLink } from '../lib/connectAgentLink.ts'
import type { ChangelogState, UpdaterState } from '../types/team.ts'

export const appApi = {
  authUpdateProfile: (input: { name: string; username: string; avatarURL: string }) =>
    window.api.authUpdateProfile(input),
  authStatus: () => window.api.authStatus(),
  authLogin: () => window.api.authLogin(),
  authLogout: () => window.api.authLogout(),
  authCancel: () => window.api.authCancel(),
  authEmailRequestCode: (email: string) => window.api.authEmailRequestCode(email),
  authEmailVerifyCode: (email: string, code: string) => window.api.authEmailVerifyCode(email, code),
  analyticsIdentify: (userId: string, props?: Record<string, unknown>) =>
    window.api.analyticsIdentify(userId, props),
  analyticsSetTeam: (teamId: string | null) => window.api.analyticsSetTeam(teamId),
  appGetVersion: () => window.api.appGetVersion(),
  appGetPlatform: () => window.api.appGetPlatform(),
  appSetNativeTheme: (source: 'system' | 'light' | 'dark') => window.api.appSetNativeTheme(source),
  onNativeThemeUpdated: (cb: (payload: { shouldUseDarkColors: boolean }) => void) =>
    window.api.onNativeThemeUpdated?.(cb) ?? (() => {}),
  appHideWindow: () => window.api.appHideWindow(),
  listAgentChatSkills: () => window.api.listAgentChatSkills(),
  installAgentChatSkill: (target: AgentChatSkillTarget, skillId: AgentChatSkillId) =>
    window.api.installAgentChatSkill(target, skillId),
  uninstallAgentChatSkill: (target: AgentChatSkillTarget, skillId: AgentChatSkillId) =>
    window.api.uninstallAgentChatSkill(target, skillId),
  openAgentChatSkillsFolder: (target: AgentChatSkillTarget) =>
    window.api.openAgentChatSkillsFolder(target),
  onAgentChatDeepLink: (cb: (payload: AgentChatDeepLinkPayload) => void) =>
    window.api.onAgentChatDeepLink(cb),
  onAppOpenDeepLink: (cb: (payload: AppOpenDeepLinkPayload) => void) =>
    window.api.onAppOpenDeepLink(cb),
  onConnectAgentDeepLink: (cb: (payload: ConnectAgentLink) => void) =>
    window.api.onConnectAgentDeepLink(cb),
  onAgentFocusSession: (cb: (payload: AgentFocusSessionPayload) => void) =>
    window.api.onAgentFocusSession(cb),
  selectLocalFile: () => window.api.selectLocalFile(),
  selectLocalFolder: () => window.api.selectLocalFolder(),
  saveTextFile: (defaultPath: string, content: string) =>
    window.api.saveTextFile(defaultPath, content),
  listLocalAgentSessions: (source: LocalSessionSource) => window.api.listLocalAgentSessions(source),
  getPathForFile: (file: File) => window.api.getPathForFile(file),
  savePastedAttachments: (payload: PastedAttachmentPayload) =>
    window.api.savePastedAttachments(payload),
  updaterGetState: () => window.api.updaterGetState(),
  updaterCheck: () => window.api.updaterCheck(),
  updaterInstall: () => window.api.updaterInstall(),
  onUpdaterStatus: (cb: (state: UpdaterState) => void) => window.api.onUpdaterStatus(cb),
  changelogGetState: () => window.api.changelogGetState(),
  onChangelogStatus: (cb: (state: ChangelogState) => void) => window.api.onChangelogStatus(cb),
  atlasListTeams: () => window.api.atlasListTeams(),
  archListDiagrams: (teamId: string) => window.api.archListDiagrams(teamId),
  archGetDiagram: (teamId: string, diagramId: string) =>
    window.api.archGetDiagram(teamId, diagramId),
  archCreateDiagram: (teamId: string, name: string) => window.api.archCreateDiagram(teamId, name),
  archSaveDiagram: (
    teamId: string,
    diagramId: string,
    patch: { name?: string; nodes?: Diagram['nodes']; views?: Diagram['views'] },
  ) => window.api.archSaveDiagram(teamId, diagramId, patch),
  archDeleteDiagram: (teamId: string, diagramId: string) =>
    window.api.archDeleteDiagram(teamId, diagramId),
  dashboardsList: (teamId: string) => window.api.dashboardsList(teamId),
  dashboardsCreate: (teamId: string, input: import('../dashboards/schema').CreateDashboardInput) =>
    window.api.dashboardsCreate(teamId, input),
  dashboardsGet: (teamId: string, dashboardId: string, viewRange?: DashboardViewRange) =>
    window.api.dashboardsGet(teamId, dashboardId, viewRange),
  dashboardsUpdate: (
    teamId: string,
    dashboardId: string,
    input: import('../dashboards/schema').UpdateDashboardInput,
  ) => window.api.dashboardsUpdate(teamId, dashboardId, input),
  dashboardsDelete: (teamId: string, dashboardId: string) =>
    window.api.dashboardsDelete(teamId, dashboardId),
  dashboardsRefresh: (
    teamId: string,
    dashboardId: string,
    force?: boolean,
    viewRange?: DashboardViewRange,
  ) => window.api.dashboardsRefresh(teamId, dashboardId, force, viewRange),
  dashboardsCreatePanel: (
    teamId: string,
    dashboardId: string,
    input: import('../dashboards/schema').CreatePanelInput,
  ) => window.api.dashboardsCreatePanel(teamId, dashboardId, input),
  dashboardsUpdatePanel: (
    teamId: string,
    dashboardId: string,
    panelId: string,
    input: import('../dashboards/schema').UpdatePanelInput,
  ) => window.api.dashboardsUpdatePanel(teamId, dashboardId, panelId, input),
  dashboardsDeletePanel: (teamId: string, dashboardId: string, panelId: string) =>
    window.api.dashboardsDeletePanel(teamId, dashboardId, panelId),
  dashboardsExecutePanel: (
    teamId: string,
    dashboardId: string,
    panelId: string,
    force?: boolean,
    viewRange?: DashboardViewRange,
  ) => window.api.dashboardsExecutePanel(teamId, dashboardId, panelId, force, viewRange),
  dashboardsGenerateInsight: (
    teamId: string,
    dashboardId: string,
    panelId: string,
    viewRange?: DashboardViewRange,
  ) => window.api.dashboardsGenerateInsight(teamId, dashboardId, panelId, viewRange),
  dashboardsInsightFeedback: (
    teamId: string,
    dashboardId: string,
    panelId: string,
    rating: 'up' | 'down',
    note?: string,
    viewRange?: DashboardViewRange,
  ) => window.api.dashboardsInsightFeedback(teamId, dashboardId, panelId, rating, note, viewRange),
  dashboardsGetAlert: (teamId: string, dashboardId: string, panelId: string) =>
    window.api.dashboardsGetAlert(teamId, dashboardId, panelId),
  dashboardsSaveAlert: (
    teamId: string,
    dashboardId: string,
    panelId: string,
    input: import('../dashboards/schema').DashboardPanelAlertInput,
  ) => window.api.dashboardsSaveAlert(teamId, dashboardId, panelId, input),
  dashboardsDeleteAlert: (teamId: string, dashboardId: string, panelId: string) =>
    window.api.dashboardsDeleteAlert(teamId, dashboardId, panelId),
  teamSkillsGetManifest: (teamId: string) => window.api.teamSkillsGetManifest(teamId),
  teamSkillsListObjects: (teamId: string) => window.api.teamSkillsListObjects(teamId),
  teamSkillsGetObject: (teamId: string, key: string) => window.api.teamSkillsGetObject(teamId, key),
  teamSkillsGetHistory: (teamId: string, name: string) =>
    window.api.teamSkillsGetHistory(teamId, name),
  teamSkillsPutObject: (
    teamId: string,
    key: string,
    file: { filename: string; bytes: Uint8Array; contentType?: string },
  ) => window.api.teamSkillsPutObject(teamId, key, file),
  teamSkillsListLocal: () => window.api.teamSkillsListLocal(),
  teamSkillsImportLocal: (teamId: string, skillId: string) =>
    window.api.teamSkillsImportLocal(teamId, skillId),
  teamSkillsDeleteObject: (teamId: string, key: string) =>
    window.api.teamSkillsDeleteObject(teamId, key),
  teamSkillsDeleteSkill: (teamId: string, name: string) =>
    window.api.teamSkillsDeleteSkill(teamId, name),
}
