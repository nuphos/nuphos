import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { shell } from 'electron'

import * as atlas from '../atlas'
import { downloadTo, resolveDownloads, uploadFiles } from '../fileTransfer'

import { getDeviceIdentity, listDeviceAudit, updateDeviceLabel } from './device-controller.ts'
import { transferLinkedFile } from './linked-file-transfer.ts'
import { readThisComputerFile, resolveThisComputerFile } from './linked-file.ts'
import { installAgentCli } from './local-runtime/agent-cli-install.ts'
import { latestAgentCliVersions, updateAgentCli } from './local-runtime/agent-cli-update.ts'
import {
  cancelLocalClaudeLogin,
  cancelLocalCodexLogin,
  getLocalRuntimeState,
  listLocalRuntimeActivity,
  openLocalRuntimeWorkspace,
  refreshLocalRuntime,
  setPhoneControl,
  startLocalClaudeLogin,
  startLocalCodexLogin,
  submitLocalClaudeLoginCode,
  userEnv,
} from './local-runtime/index.ts'
import { setSleepPreferences } from './local-runtime/sleep-prevention-electron.ts'

import type { LocalAgentProvider } from './local-runtime/agent-cli.ts'

async function copyAgentFile(...args: [string, string, string, string]) {
  const copy = await atlas.transferRuntimeFile(...args)
  const target = join(await mkdtemp(join(tmpdir(), 'nuphos-html-')), basename(copy.fileName))

  await downloadTo(copy.url, target)

  return target
}

export const deviceChannels = {
  'device:getIdentity': () => getDeviceIdentity(),
  'device:setLabel': (_e: unknown, label: string) => updateDeviceLabel(label),
  'device:listAudit': (_e: unknown, before?: string) => listDeviceAudit(before),
  'localRuntime:startCodexLogin': () => startLocalCodexLogin(),
  'localRuntime:cancelCodexLogin': () => cancelLocalCodexLogin(),
  'localRuntime:submitClaudeLoginCode': (_e: unknown, code: unknown) =>
    submitLocalClaudeLoginCode(code),
  'localRuntime:startClaudeLogin': () => startLocalClaudeLogin(),
  'localRuntime:cancelClaudeLogin': () => cancelLocalClaudeLogin(),
  'localRuntime:setSleepPreferences': (_e: unknown, value: unknown) => setSleepPreferences(value),
  'localRuntime:setPhoneControl': (_e: unknown, allowed: unknown) =>
    setPhoneControl(allowed === true),
  'localRuntime:getState': () => getLocalRuntimeState(),
  'atlas:readLinkedFile': async (_e: unknown, ...args: [string, string, string, string]) => {
    const local = await readThisComputerFile(args[3], getLocalRuntimeState().workspace)

    return local
      ? { ...local, origin: 'this-computer' as const }
      : { ...(await atlas.readRuntimeFile(...args)), origin: 'agent' as const }
  },
  'atlas:transferLinkedFile': (_e: unknown, ...args: [string, string, string, string]) =>
    transferLinkedFile(args, getLocalRuntimeState().workspace, {
      uploadFiles,
      resolveDownloads,
      transferRuntimeFile: atlas.transferRuntimeFile,
    }),
  // An HTML file opens from where Files read it: in place on this computer, so
  // the files next to it load too, or else as a single-file copy of the agent's.
  'atlas:openHtmlFile': async (
    _e: unknown,
    local: boolean,
    ...args: [string, string, string, string]
  ) => {
    if (!/\.html?$/i.test(args[3])) throw new Error('Only HTML files open in the browser.')
    const target = local
      ? await resolveThisComputerFile(args[3], getLocalRuntimeState().workspace)
      : await copyAgentFile(...args)

    if (!target) throw new Error('The file is no longer on this computer.')
    await shell.openExternal(pathToFileURL(target).href)
  },
  'localRuntime:refresh': () => refreshLocalRuntime(),
  // Running agents keep their version; the next one started picks up the update.
  'localRuntime:updateAgent': async (_e: unknown, provider: LocalAgentProvider) => {
    await updateAgentCli(provider, await userEnv())

    return refreshLocalRuntime()
  },
  'localRuntime:installAgent': async (_e: unknown, provider: LocalAgentProvider) => {
    await installAgentCli(provider, await userEnv())

    return refreshLocalRuntime()
  },
  'localRuntime:latestAgentVersions': () => latestAgentCliVersions(),
  'localRuntime:openWorkspace': () => openLocalRuntimeWorkspace(),
  'localRuntime:listActivity': (_e: unknown, before?: string) => listLocalRuntimeActivity(before),
}
