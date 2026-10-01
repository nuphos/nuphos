import fsSync from 'node:fs'
import fs from 'node:fs/promises'

import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron'

import * as agentChatSkill from '../agent-chat-skill'
import { resetAnalyticsUser, setAnalyticsTeam, setAnalyticsUser } from '../analytics'
import * as atlas from '../atlas'
import * as auth from '../auth'
import { updateProfile } from '../auth/profile'
import * as fileTransfer from '../fileTransfer'
import { readImageAttachment, registerAttachment } from '../imageAttachment'
import { raiseWindow } from '../window-raise'

import { getChangelogState } from './changelog'
import { pickPaths, savePastedAttachments } from './dialogs'
import { isDev } from './env'
import { importLocalSession } from '../agent/local-session-import'

import { listLocalAgentSessions, validateLocalSessionSource } from './local-sessions'
import { writePersistedThemeSource } from './theme'
import { autoUpdater, checkForUpdatesOnce, getUpdaterState, setUpdaterState } from './updater'
import { mostRecentlyFocusedVisibleAppWindow } from './windows'

import type { PastedAttachmentPayload } from './dialogs'
import type { ThemeSource } from './theme'
import type { IpcMainInvokeEvent } from 'electron'

export const appChannels = {
  'auth:updateProfile': (
    _e: unknown,
    input: { name: string; username: string; avatarURL: string },
  ) => updateProfile(input),
  'auth:status': () => auth.status(),
  // login/logout PostHog events are owned by the renderer (posthog-js in
  // App.tsx), which has the user object at the moment of success. The main
  // process only manages identity stitching (alias/identify/reset), not the
  // events, to avoid double-counting.
  'auth:login': () => auth.login(),
  'auth:logout': async () => {
    const result = await auth.logout()

    resetAnalyticsUser()

    return result
  },
  'auth:cancel': () => auth.cancelPendingLogin(),
  'auth:emailRequestCode': (_e: unknown, email: string) => auth.requestEmailCode(email),
  'auth:emailVerifyCode': (_e: unknown, email: string, code: string) =>
    auth.verifyEmailCode(email, code),
  'analytics:identify': (_e: unknown, userId: string, props?: Record<string, unknown>) => {
    setAnalyticsUser(userId, props)
  },
  'analytics:setTeam': (_e: unknown, teamId: string | null) => {
    setAnalyticsTeam(teamId)
  },
  'app:getVersion': () => app.getVersion(),
  'app:getPlatform': () => process.platform,
  'app:setNativeTheme': (_e: unknown, source: ThemeSource) => {
    if (source !== 'system' && source !== 'light' && source !== 'dark') {
      throw new Error(`Invalid theme source: ${String(source)}`)
    }
    nativeTheme.themeSource = source
    writePersistedThemeSource(source)
  },
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
  'app:openExternal': async (_e: unknown, url: string) => {
    const parsed = new URL(url)

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only http and https URLs can be opened externally.')
    }
    await shell.openExternal(parsed.toString())
  },
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
      agentRuntime: 'claude-code' | 'codex'
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
    args: { teamId: string; sessionId?: string; groupId: string },
  ) => fileTransfer.resolveDownloads(args.teamId, args.sessionId, args.groupId),
  'fileTransfer:listDownloads': (
    _e: IpcMainInvokeEvent,
    args: { teamId: string; sessionId?: string },
  ) => atlas.listFileTransferDownloads(args.teamId, args.sessionId),
  'fileTransfer:revealInFolder': (_e: IpcMainInvokeEvent, path: string) => {
    if (path) shell.showItemInFolder(path)
  },
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
  'fileTransfer:downloadOne': async (
    e: IpcMainInvokeEvent,
    args: { teamId: string; sessionId?: string; groupId: string; fileId: string; fileName: string },
  ) => {
    const parentWindow = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const result = await dialog.showSaveDialog(
      parentWindow && !parentWindow.isDestroyed() ? parentWindow : (undefined as never),
      { defaultPath: args.fileName },
    )

    if (result.canceled || !result.filePath) return { saved: false }
    await fileTransfer.downloadOne({ ...args, destPath: result.filePath })

    return { saved: true, path: result.filePath }
  },
  'fileTransfer:downloadAllZip': async (
    e: IpcMainInvokeEvent,
    args: { teamId: string; sessionId?: string; groupId: string; zipName: string },
  ) => {
    const parentWindow = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const result = await dialog.showSaveDialog(
      parentWindow && !parentWindow.isDestroyed() ? parentWindow : (undefined as never),
      { defaultPath: args.zipName.endsWith('.zip') ? args.zipName : `${args.zipName}.zip` },
    )

    if (result.canceled || !result.filePath) return { saved: false }
    const out = await fileTransfer.downloadAllAsZip({
      teamId: args.teamId,
      sessionId: args.sessionId,
      groupId: args.groupId,
      destZipPath: result.filePath,
    })

    return { saved: true, path: result.filePath, ...out }
  },
  'changelog:getState': () => getChangelogState(),
  'updater:getState': () => getUpdaterState(),
  'updater:check': () => {
    if (isDev) {
      setUpdaterState({ kind: 'error', message: 'Updates disabled in dev mode' })

      return getUpdaterState()
    }

    return checkForUpdatesOnce()
  },
  'updater:install': () => {
    if (getUpdaterState().kind === 'downloaded') autoUpdater.quitAndInstall()
  },
} as const
