import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)

// Ask before Codex can create a cursor, not inside the native client's 5s cleanup handshake.
// osascript inherits the signed Desktop's TCC identity; no timeout on a human decision.
export const COMPUTER_USE_PERMISSION_SCRIPT = `
ObjC.import('Cocoa');
ObjC.bindFunction('AEDeterminePermissionToAutomateTarget', ['int', ['void *', 'unsigned int', 'unsigned int', 'bool']]);
function run(argv) {
  var url = $.NSURL.fileURLWithPath(argv[0]);
  var service = $.NSWorkspace.sharedWorkspace.launchApplicationAtURLOptionsConfigurationError(url, 512, $.NSDictionary.dictionary, Ref());
  if (!service || service.isNil()) throw new Error('Computer Use service could not start');
  var target = $.NSAppleEventDescriptor.descriptorWithProcessIdentifier(service.processIdentifier);
  var status = $.AEDeterminePermissionToAutomateTarget(target.aeDesc, 0x536b4375, 0x5870634e, true);
  if (status !== 0) throw new Error('Computer Use automation permission was not granted (' + status + ')');
}
`

export async function prepareComputerUse(): Promise<void> {
  if (process.platform !== 'darwin') return
  const ownerHome = process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex')
  const service = path.join(ownerHome, 'computer-use', 'Codex Computer Use.app')

  if (!existsSync(service)) return
  try {
    await execute('/usr/bin/osascript', [
      '-l',
      'JavaScript',
      '-e',
      COMPUTER_USE_PERMISSION_SCRIPT,
      service,
    ])
  } catch {
    throw new Error(
      'Allow Nuphos to automate Computer Use in macOS System Settings, then restart the local Codex agent.',
    )
  }
}
