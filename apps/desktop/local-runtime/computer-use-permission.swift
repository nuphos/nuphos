import AppKit
import Carbon

// Apple requires permission prompting off the main thread. Keep its run loop alive
// while the worker waits for consent, rather than putting consent inside the 5s XPC handshake.
DispatchQueue.global().async {
    guard let service = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.sky.CUAService").first else {
        fputs("Computer Use service is not running\n", stderr)
        exit(1)
    }
    var pid = service.processIdentifier
    var target = AEAddressDesc()
    let created = withUnsafePointer(to: &pid) {
        AECreateDesc(typeKernelProcessID, $0, MemoryLayout<pid_t>.size, &target)
    }
    guard created == noErr else { exit(1) }
    defer { AEDisposeDesc(&target) }
    let status = AEDeterminePermissionToAutomateTarget(&target, 0x536b4375, 0x5870634e, true)
    if status != noErr {
        fputs("Computer Use automation permission was not granted (\(status))\n", stderr)
    }
    DispatchQueue.main.async { exit(status == noErr ? 0 : 1) }
}
RunLoop.main.run()
