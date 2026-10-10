// Called only at the SDK's Computer Use approval boundary, before the native operation.
// The service is already running there. Use its bundle ID instead of guessing its home.
export const COMPUTER_USE_PERMISSION_SCRIPT = `
ObjC.import('Cocoa');
ObjC.bindFunction('AEDeterminePermissionToAutomateTarget', ['int', ['void *', 'unsigned int', 'unsigned int', 'bool']]);
var service = $.NSRunningApplication.runningApplicationsWithBundleIdentifier('com.openai.sky.CUAService').firstObject;
if (!service || service.isNil()) throw new Error('Computer Use service is not running');
var target = $.NSAppleEventDescriptor.descriptorWithProcessIdentifier(service.processIdentifier);
var status = $.AEDeterminePermissionToAutomateTarget(target.aeDesc, 0x536b4375, 0x5870634e, true);
if (status !== 0) throw new Error('Computer Use automation permission was not granted (' + status + ')');
`

export async function nuphosAuthorizeComputerUse(params, signal, execute) {
  if (process.platform !== 'darwin' || params._meta?.connector_id !== 'computer-use') return
  // Asynchronous consent has no helper handshake timeout. Cancellation still stops the waiter.
  execute ??= (await import('node:util')).promisify((await import('node:child_process')).execFile)
  await execute('/usr/bin/osascript', ['-l', 'JavaScript', '-e', COMPUTER_USE_PERMISSION_SCRIPT], {
    signal,
  })
}
