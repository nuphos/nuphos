import type { AgentProvider } from '../../src/types/runtime'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'

import * as agentChatSkill from '../agent-chat-skill'
import { setAnalyticsTeam, setAnalyticsUser } from '../analytics'
import { apiUrl } from '../api-endpoint'
import { setSendDiagnostics } from '../crash-reporter'
import { selectAsciiInputSource } from '../input-source'
import * as atlas from '../atlas'
import * as auth from '../auth'
import { removeAvatar, updateProfile, uploadAvatar } from '../auth/profile'
import * as fileTransfer from '../fileTransfer'
import { readImageAttachment, registerAttachment } from '../imageAttachment'
import { raiseWindow } from '../window-raise'

import { getChangelogState } from './changelog'
import { pickPaths, savePastedAttachments } from './dialogs'
import { setMainLocale } from './i18n-electron.ts'
import { importLocalSession } from '../agent/local-session-import'

import { listLocalAgentSessions, validateLocalSessionSource } from './local-sessions'
import { openExternal } from './open-external'
import { readAppIcon, setAppIcon } from './app-icon'
import { readLoginItem, writeLoginItem } from './login-item'
import { writePersistedThemeSource } from './theme'
import { fileTransferReadChannels } from './channels-file-transfer'
import { updaterChannels } from './channels-updater'
import { mostRecentlyFocusedVisibleAppWindow } from './windows'

import type { PastedAttachmentPayload } from './dialogs'
import type { ThemeSource } from './theme'
import type { PersonalCredentialProvider } from '../../src/types/team'
import type { IpcMainInvokeEvent } from 'electron'

export const appChannels = {
  'auth:updateProfile': (
    _e: unknown,
    input: { name: string; username: string; avatarURL: string },
  ) => updateProfile(input),
  'atlas:listPersonalCredentials': () => atlas.listPersonalCredentials(),
  'atlas:startPersonalCredential': (
    _e: unknown,
    provider: PersonalCredentialProvider,
    teamId?: string,
  ) => atlas.startPersonalCredential(provider, teamId),
  'atlas:deletePersonalCredential': (
    _e: unknown,
    provider: PersonalCredentialProvider,
    teamId?: string,
  ) => atlas.deletePersonalCredential(provider, teamId),
  'atlas:listSignInSessions': () => atlas.listSignInSessions(),
  'atlas:signOutSession': (_e: unknown, id: string) => atlas.signOutSession(id),
  'atlas:signOutOtherSessions': () => atlas.signOutOtherSessions(),
  'atlas:getMfaStatus': () => atlas.getMfaStatus(),
  'atlas:startMfaSetup': () => atlas.startMfaSetup(),
  'atlas:confirmMfaSetup': (_e: unknown, code: string) => atlas.confirmMfaSetup(code),
  'atlas:newMfaRecoveryCodes': (_e: unknown, code: string) => atlas.newMfaRecoveryCodes(code),
  'atlas:disableMfa': (_e: unknown, code: string) => atlas.disableMfa(code),
  'atlas:reauthMfa': (_e: unknown, code: string) => atlas.reauthMfa(code),
  'atlas:reauthWithPasskey': () => atlas.reauthWithPasskey(),
  'atlas:addPasskey': () => atlas.addPasskey(),
  'atlas:removePasskey': (_e: unknown, id: string, code: string) => atlas.removePasskey(id, code),
  'auth:uploadAvatar': (_e: unknown, image: Uint8Array) => uploadAvatar(image),
  'auth:removeAvatar': () => removeAvatar(),
  'auth:status': () => auth.status(),
  // login/logout PostHog events are owned by the renderer (posthog-js in
  // App.tsx), which has the user object at the moment of success. The main
  // process only manages identity stitching (alias/identify/reset), not the
  // events, to avoid double-counting.
  'auth:socialProviders': () => auth.socialProviders(),
  'auth:login': (_e: unknown, provider: auth.SocialProvider) => auth.login(provider),
  // The analytics identity is reset when the account is left (account-leave.ts),
  // not when these return: a slow revoke must not clear the next account's.
  'auth:logout': () => auth.logout(),
  'auth:cancel': () => auth.cancelPendingLogin(),
  // Leaving the active account reloads every window (account-leave.ts).
  'auth:listAccounts': () => auth.listAccounts(),
  'auth:switchAccount': (_e: unknown, key: string) => auth.switchAccount(key),
  'auth:signOutAccount': (_e: unknown, key: string) => auth.signOutAccount(key),
  'auth:signOutAllAccounts': () => auth.signOutAllAccounts(),
  'auth:emailRequestCode': (_e: unknown, email: string) => auth.requestEmailCode(email),
  'auth:emailVerifyCode': (_e: unknown, email: string, code: string) =>
    auth.verifyEmailCode(email, code),
  'auth:mfaVerify': (_e: unknown, mfaToken: string, code: string) => auth.verifyMfa(mfaToken, code),
  'auth:mfaVerifyPasskey': (_e: unknown, mfaToken: string) => auth.verifyMfaWithPasskey(mfaToken),
  'analytics:identify': (_e: unknown, userId: string, props?: Record<string, unknown>) => {
    setAnalyticsUser(userId, props)
  },
  'analytics:setTeam': (_e: unknown, teamId: string | null) => {
    setAnalyticsTeam(teamId)
  },
  'diagnostics:set': (_e: unknown, send: unknown) => setSendDiagnostics(send),
  'app:getVersion': () => app.getVersion(),
  'app:setApiEndpoint': (_e: unknown, url: string | null) => auth.changeBackend(url),
  'app:getPlatform': () => process.platform,
  'app:selectAsciiInputSource': () => selectAsciiInputSource(),
  'app:setNativeTheme': (_e: unknown, source: ThemeSource) => {
    if (source !== 'system' && source !== 'light' && source !== 'dark') {
      throw new Error(`Invalid theme source: ${String(source)}`)
    }
    nativeTheme.themeSource = source
    writePersistedThemeSource(source)
  },
  'app:getAppIcon': () => readAppIcon(),
  'app:setAppIcon': (_e: unknown, icon: string) => setAppIcon(icon),
  'app:setLocale': (_e: unknown, locale: unknown) => setMainLocale(locale),
  'app:getLoginItem': () => readLoginItem(app, process.platform),
  'app:setLoginItem': (_e: unknown, openAtLogin: unknown) =>
    writeLoginItem(app, process.platform, openAtLogin),
  'app:hideWindow': (e: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(e.sender)

    if (!win) return
    win.hide()
    const next = mostRecentlyFocusedVisibleAppWindow(win)

    if (next) raiseWindow(next)
  },
  'agent-chat:listSkills': () => agentChatSkill.listAgentChatSkillStatuses(),
  'agent-chat:installSkill': (
    _e: unknown,
    target: agentChatSkill.AgentChatSkillTarget,
    skillId: agentChatSkill.AgentChatSkillId,
  ) => agentChatSkill.installAgentChatSkill(target, skillId),
  'agent-chat:uninstallSkill': (
    _e: unknown,
    target: agentChatSkill.AgentChatSkillTarget,
    skillId: agentChatSkill.AgentChatSkillId,
  ) => agentChatSkill.uninstallAgentChatSkill(target, skillId),
  'agent-chat:openSkillsFolder': async (
    _e: unknown,
    target: agentChatSkill.AgentChatSkillTarget,
  ) => {
    const folder = await agentChatSkill.ensureAgentChatSkillsFolder(target)
    const error = await shell.openPath(folder)

    if (error) throw new Error(error)
  },
  'app:openExternal': (_e: unknown, url: string) => openExternal(url),
  'app:openSsh': async (_e: unknown, url: string) => {
    const parsed = new URL(url)

    if (parsed.protocol !== 'ssh:') {
      throw new Error('Only ssh URLs can be opened by this action.')
    }
    await shell.openExternal(parsed.toString())
  },
  'dialog:selectLocalFile': async (e: IpcMainInvokeEvent) =>
    pickPaths(e, ['openFile', 'multiSelections']),
  'dialog:selectLocalFolder': async (e: IpcMainInvokeEvent) =>
    pickPaths(e, ['openDirectory', 'multiSelections']),
  // Continues one of those sessions as a Nuphos conversation on a team agent.
  'agent:importLocalSession': (
    _e: IpcMainInvokeEvent,
    args: {
      source: string
      id: string
      teamId: string
      runtimeId: string
      agentRuntime: AgentProvider
    },
  ) => importLocalSession(args),
  'dialog:listLocalAgentSessions': async (_e: IpcMainInvokeEvent, rawSource: string) => {
    const source = validateLocalSessionSource(rawSource)

    return listLocalAgentSessions(source)
  },
  // Generic "save this text to a file the user picks" — used by the log
  // viewer's Download as Text / CSV. The renderer builds the content; the main
  // process owns the save dialog + write.
  'dialog:saveTextFile': async (
    e: IpcMainInvokeEvent,
    args: { defaultPath: string; content: string },
  ) => {
    const parentWindow = BrowserWindow.fromWebContents(e.sender)
    const result =
      parentWindow && !parentWindow.isDestroyed()
        ? await dialog.showSaveDialog(parentWindow, { defaultPath: args.defaultPath })
        : await dialog.showSaveDialog({ defaultPath: args.defaultPath })

    if (result.canceled || !result.filePath) return { saved: false }
    await fs.writeFile(result.filePath, args.content, 'utf-8')

    return { saved: true, path: result.filePath }
  },
  'clipboard:savePastedAttachments': async (
    _e: IpcMainInvokeEvent,
    payload: PastedAttachmentPayload,
  ) => savePastedAttachments(payload),
  // --- File transfer ---
  'fileTransfer:upload': (
    _e: IpcMainInvokeEvent,
    args: { teamId: string; sessionId?: string; filePaths: string[]; label?: string },
  ) => fileTransfer.uploadFiles(args),
  'fileTransfer:resolve': (
    _e: IpcMainInvokeEvent,
    args: { teamId: string; sessionId?: string; groupId: string; channelId?: string },
  ) => fileTransfer.resolveDownloads(args.teamId, args.sessionId, args.groupId, args.channelId),
  // An HTML or Markdown file's text for the in-app preview; capped, never written to disk.
  'fileTransfer:readText': (
    _e: IpcMainInvokeEvent,
    args: {
      teamId: string
      sessionId?: string
      groupId: string
      fileId: string
      channelId?: string
    },
  ) => fileTransfer.readText(args),
  'fileTransfer:listDownloads': (
    _e: IpcMainInvokeEvent,
    args: { teamId: string; sessionId?: string },
  ) => atlas.listFileTransferDownloads(args.teamId, args.sessionId),
  ...fileTransferReadChannels,
  // Read an attached image into a vision data URL — no upload. Also
  // registers the path so a later upload_attachment tool call can transfer it.
  'attachment:readImage': async (_e: IpcMainInvokeEvent, path: string) => {
    const img = await readImageAttachment(path)

    if (!img) return null

    return { ...img, attachmentId: await registerAttachment(path) }
  },
  // Which of these paths are directories — drop gives paths but not
  // their kind, so the composer asks here to label folder chips correctly.
  'attachment:directoryPaths': async (_e: IpcMainInvokeEvent, paths: string[]) => {
    const dirs: string[] = []

    for (const p of Array.isArray(paths) ? paths : []) {
      try {
        if ((await fsSync.promises.stat(p)).isDirectory()) dirs.push(p)
      } catch {
        // Ignore unreadable paths — they just stay labeled as files.
      }
    }

    return dirs
  },
  'changelog:getState': () => getChangelogState(),
  ...updaterChannels,
} as const

// Avatar trust runs during render, so the renderer reads the endpoint synchronously.
ipcMain.on('app:apiUrlSync', (event) => {
  event.returnValue = apiUrl()
})
