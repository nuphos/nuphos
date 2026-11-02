import type {
  AgentChatDeepLinkPayload,
  AgentChatSkillId,
  AgentChatSkillTarget,
  AgentFocusSessionPayload,
  AppOpenDeepLinkPayload,
  LocalSessionSource,
  PastedAttachmentPayload,
} from './app-types.ts'
import type { SkillScope } from './plan-types.ts'
import type { Diagram } from '../architecture/schema.ts'
import type { DesignOp, DesignPage } from '../design/schema.ts'
import type { DashboardViewRange } from '../dashboards/schema'
import type { ConnectAgentLink } from '../lib/connectAgentLink.ts'
import type {
  ChangelogState,
  PersonalCredentialDeepLinkPayload,
  PersonalCredentialProvider,
  SocialProvider,
  UpdaterState,
} from '../types/team.ts'

export const appApi = {
  authUpdateProfile: (input: { name: string; username: string; avatarURL: string }) =>
    window.api.authUpdateProfile(input),
  atlasListPersonalCredentials: () => window.api.atlasListPersonalCredentials(),
  atlasStartPersonalCredential: (provider: PersonalCredentialProvider, teamId?: string) =>
    window.api.atlasStartPersonalCredential(provider, teamId),
  atlasDeletePersonalCredential: (provider: PersonalCredentialProvider, teamId?: string) =>
    window.api.atlasDeletePersonalCredential(provider, teamId),
  atlasListSignInSessions: () => window.api.atlasListSignInSessions(),
  atlasSignOutSession: (id: string) => window.api.atlasSignOutSession(id),
  atlasSignOutOtherSessions: () => window.api.atlasSignOutOtherSessions(),
  authUploadAvatar: (image: Uint8Array) => window.api.authUploadAvatar(image),
  authRemoveAvatar: () => window.api.authRemoveAvatar(),
  authStatus: () => window.api.authStatus(),
  authSocialProviders: () => window.api.authSocialProviders(),
  authLogin: (provider: SocialProvider) => window.api.authLogin(provider),
  authLogout: () => window.api.authLogout(),
  authCancel: () => window.api.authCancel(),
  authEmailRequestCode: (email: string) => window.api.authEmailRequestCode(email),
  authEmailVerifyCode: (email: string, code: string) => window.api.authEmailVerifyCode(email, code),
  analyticsIdentify: (userId: string, props?: Record<string, unknown>) =>
    window.api.analyticsIdentify(userId, props),
  analyticsSetTeam: (teamId: string | null) => window.api.analyticsSetTeam(teamId),
  sendDiagnostics: () => window.api.sendDiagnostics(),
  setSendDiagnostics: (send: boolean) => window.api.setSendDiagnostics(send),
  appGetVersion: () => window.api.appGetVersion(),
  appSetApiEndpoint: (url: string | null) => window.api.appSetApiEndpoint(url),
  appGetPlatform: () => window.api.appGetPlatform(),
  appSelectAsciiInputSource: () => window.api.appSelectAsciiInputSource(),
  appSetNativeTheme: (source: 'system' | 'light' | 'dark') => window.api.appSetNativeTheme(source),
  appGetAppIcon: () => window.api.appGetAppIcon(),
  appSetAppIcon: (icon: string) => window.api.appSetAppIcon(icon),
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
  onWebUrlDeepLink: (cb: (url: string) => void) => window.api.onWebUrlDeepLink(cb),
  onPersonalCredentialDeepLink: (cb: (payload: PersonalCredentialDeepLinkPayload) => void) =>
    window.api.onPersonalCredentialDeepLink(cb),
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
  designsList: (teamId: string) => window.api.designsList(teamId),
  designsStamp: (teamId: string, designId: string) => window.api.designsStamp(teamId, designId),
  designsGet: (teamId: string, designId: string) => window.api.designsGet(teamId, designId),
  designsCreate: (teamId: string, input: { name?: string; pages?: DesignPage[] }) =>
    window.api.designsCreate(teamId, input),
  designsReplace: (
    teamId: string,
    designId: string,
    /** Replacing `pages` needs the `updatedAt` last read; a mismatch is a 409. */
    patch: { name?: string; pages?: DesignPage[]; updatedAt?: string },
  ) => window.api.designsReplace(teamId, designId, patch),
  designsApplyOps: (teamId: string, designId: string, ops: DesignOp[]) =>
    window.api.designsApplyOps(teamId, designId, ops),
  designsDelete: (teamId: string, designId: string) => window.api.designsDelete(teamId, designId),
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
  teamSkillsGetManifest: (teamId: string, scope?: SkillScope) =>
    window.api.teamSkillsGetManifest(teamId, scope),
  teamSkillsListObjects: (teamId: string, scope?: SkillScope) =>
    window.api.teamSkillsListObjects(teamId, scope),
  teamSkillsGetObject: (teamId: string, key: string, scope?: SkillScope) =>
    window.api.teamSkillsGetObject(teamId, key, scope),
  teamSkillsGetHistory: (teamId: string, name: string, scope?: SkillScope) =>
    window.api.teamSkillsGetHistory(teamId, name, scope),
  teamSkillsPutObject: (
    teamId: string,
    key: string,
    file: { filename: string; bytes: Uint8Array; contentType?: string },
    scope?: SkillScope,
  ) => window.api.teamSkillsPutObject(teamId, key, file, scope),
  teamSkillsListLocal: () => window.api.teamSkillsListLocal(),
  localSetupStatus: (teamId: string) => window.api.localSetupStatus(teamId),
  localSetupSync: (teamId: string) => window.api.localSetupSync(teamId),
  localSetupSetAutoSync: (teamId: string, enabled: boolean) =>
    window.api.localSetupSetAutoSync(teamId, enabled),
  teamSkillsImportLocal: (teamId: string, skillId: string, scope?: SkillScope) =>
    window.api.teamSkillsImportLocal(teamId, skillId, scope),
  teamSkillsDeleteObject: (teamId: string, key: string, scope?: SkillScope) =>
    window.api.teamSkillsDeleteObject(teamId, key, scope),
  teamSkillsDeleteSkill: (teamId: string, name: string, scope?: SkillScope) =>
    window.api.teamSkillsDeleteSkill(teamId, name, scope),
  teamSkillsPromote: (teamId: string, name: string) => window.api.teamSkillsPromote(teamId, name),
}
