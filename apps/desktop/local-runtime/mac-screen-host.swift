// Serves this Mac's main display as a conversation's desktop, with no Mac
// account: the viewer reaches it only through the owner's authenticated relay.
//
//   mac-screen-host <socket-path>
//
// It speaks the part of RFB 3.8 the relay and both viewers already use, with
// security None, and sends the screen as Open H.264 rectangles (encoding 50).
// Capture and encoding follow Sill (github.com/Saffsanity/sill, Apache-2.0,
// Copyright 2026 Noah Saffer): ScreenCaptureKit at the display's size in
// points, VideoToolbox in real time with no frame reordering, a keyframe at
// least every 4 s, and only the newest frame kept, so a slow link shows the
// present rather than a queue. Unlike Sill it uses H.264, which noVNC in the
// Desktop app also decodes, and it encodes a frame only when the viewer has
// asked for one, so exactly one frame is ever in flight.
//
// Needs Screen Recording (capture) and Accessibility (input) for the app that
// launches it.

import AppKit
import CoreMedia
import Darwin
import ScreenCaptureKit
import VideoToolbox

setvbuf(stdout, nil, _IOLBF, 0)
// A viewer that leaves mid-write must not take the host down with it.
signal(SIGPIPE, SIG_IGN)
// Nuphos started this host; only Nuphos may connect, and the host goes when Nuphos does.
let parent = getppid()
let parentGone = DispatchSource.makeProcessSource(identifier: parent, eventMask: .exit, queue: .main)
parentGone.setEventHandler { leave() }
parentGone.resume()
// Nuphos stops the host with SIGTERM (phone control switched off, the app quitting).
signal(SIGTERM, SIG_IGN)
let terminated = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
terminated.setEventHandler { leave() }
terminated.resume()

/// Every window a viewer fitted, so the host puts them back however it ends.
let fittedLock = NSLock()
nonisolated(unsafe) var fittedWindows: [ObjectIdentifier: FittedWindow] = [:]

func leave() -> Never {
    fittedLock.lock()
    let windows = fittedWindows.values
    fittedLock.unlock()
    for window in windows { window.restore() }
    exit(0)
}
if getppid() != parent { exit(0) }
guard CommandLine.arguments.count == 2 else {
    fputs("usage: mac-screen-host <socket-path>\n", stderr)
    exit(64)
}
let socketPath = CommandLine.arguments[1]

func fail(_ message: String) -> Never {
    fputs("mac-screen-host: \(message)\n", stderr)
    exit(1)
}

if !CGPreflightScreenCaptureAccess() {
    CGRequestScreenCaptureAccess()
    fail("Screen Recording is not allowed for Nuphos yet")
}
if !AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary) {
    print("Accessibility is not allowed yet: the viewer can watch but not control")
}

// MARK: - Socket

nonisolated final class Connection: @unchecked Sendable {
    let fd: Int32
    private let writes = DispatchQueue(label: "mac-screen-host.write")
    /// Set on the write queue, so nothing is written to the fd once it may belong to another viewer.
    private var closed = false

    init(fd: Int32) { self.fd = fd }

    func read(_ count: Int) -> [UInt8]? {
        var out = [UInt8](repeating: 0, count: count)
        var got = 0
        while got < count {
            let n = out.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress! + got, count - got) }
            if n <= 0 { return nil }
            got += n
        }
        return out
    }

    func send(_ bytes: [UInt8]) {
        writes.async { [self] in
            guard !closed else { return }
            var sent = 0
            while sent < bytes.count {
                let n = bytes.withUnsafeBytes { Darwin.write(fd, $0.baseAddress! + sent, bytes.count - sent) }
                if n <= 0 { return }
                sent += n
            }
        }
    }

    func close() {
        writes.async { [self] in
            guard !closed else { return }
            closed = true
            Darwin.close(fd)
        }
    }
}

func be16(_ v: Int) -> [UInt8] { [UInt8(v >> 8 & 0xFF), UInt8(v & 0xFF)] }
func be32(_ v: Int) -> [UInt8] { [24, 16, 8, 0].map { UInt8(truncatingIfNeeded: v >> $0) } }

// MARK: - Encoder

/// H.264 in real time with Sill's settings. Each frame comes back as Annex B,
/// with the parameter sets in front of every keyframe.
nonisolated final class Encoder: @unchecked Sendable {
    private let session: VTCompressionSession

    init(width: Int, height: Int) {
        var made: VTCompressionSession?
        let status = VTCompressionSessionCreate(
            allocator: nil, width: Int32(width), height: Int32(height), codecType: kCMVideoCodecType_H264,
            encoderSpecification: nil, imageBufferAttributes: nil, compressedDataAllocator: nil,
            outputCallback: nil, refcon: nil, compressionSessionOut: &made)
        guard status == noErr, let made else { fail("no H.264 encoder (\(status))") }
        session = made
        func set(_ key: CFString, _ value: CFTypeRef) { VTSessionSetProperty(made, key: key, value: value) }
        set(kVTCompressionPropertyKey_RealTime, kCFBooleanTrue)
        set(kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_High_AutoLevel)
        set(kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse)
        set(kVTCompressionPropertyKey_MaxKeyFrameInterval, 120 as CFNumber)
        set(kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, 4 as CFNumber)
        set(kVTCompressionPropertyKey_ExpectedFrameRate, 30 as CFNumber)
        set(kVTCompressionPropertyKey_AverageBitRate, 6_000_000 as CFNumber)
        set(kVTCompressionPropertyKey_DataRateLimits, [6_000_000 / 8 * 2, 1] as CFArray)
        set(kVTCompressionPropertyKey_PrioritizeEncodingSpeedOverQuality, kCFBooleanTrue)
        VTCompressionSessionPrepareToEncodeFrames(made)
    }

    deinit { VTCompressionSessionInvalidate(session) }

    func encode(_ image: CVPixelBuffer, at time: CMTime, keyframe: Bool, done: @escaping @Sendable ([UInt8]?) -> Void) {
        let options = keyframe ? [kVTEncodeFrameOptionKey_ForceKeyFrame: true] as CFDictionary : nil
        let status = VTCompressionSessionEncodeFrame(
            session, imageBuffer: image, presentationTimeStamp: time, duration: .invalid,
            frameProperties: options, infoFlagsOut: nil
        ) { status, _, sample in
            guard status == noErr, let sample else { return done(nil) }
            done(Self.annexB(sample))
        }
        if status != noErr { done(nil) }
    }

    private static func annexB(_ sample: CMSampleBuffer) -> [UInt8]? {
        guard let block = CMSampleBufferGetDataBuffer(sample) else { return nil }
        let start: [UInt8] = [0, 0, 0, 1]
        var out: [UInt8] = []
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]]
        let keyframe = attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool != true
        if keyframe, let format = CMSampleBufferGetFormatDescription(sample) {
            var count = 0
            CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format, parameterSetIndex: 0, parameterSetPointerOut: nil,
                                                               parameterSetSizeOut: nil, parameterSetCountOut: &count, nalUnitHeaderLengthOut: nil)
            for index in 0..<count {
                var pointer: UnsafePointer<UInt8>?
                var size = 0
                if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format, parameterSetIndex: index, parameterSetPointerOut: &pointer,
                                                                      parameterSetSizeOut: &size, parameterSetCountOut: nil,
                                                                      nalUnitHeaderLengthOut: nil) == noErr, let pointer {
                    out += start + Array(UnsafeBufferPointer(start: pointer, count: size))
                }
            }
        }
        var length = 0
        var data: UnsafeMutablePointer<CChar>?
        guard CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &data) == noErr,
              let data else { return nil }
        let bytes = UnsafeRawPointer(data).assumingMemoryBound(to: UInt8.self)
        // The encoder writes 4-byte big-endian lengths before each unit; Annex B wants start codes.
        var offset = 0
        while offset + 4 <= length {
            let size = Int(bytes[offset]) << 24 | Int(bytes[offset + 1]) << 16 | Int(bytes[offset + 2]) << 8 | Int(bytes[offset + 3])
            offset += 4
            guard size > 0, offset + size <= length else { break }
            out += start + Array(UnsafeBufferPointer(start: bytes + offset, count: size))
            offset += size
        }
        return out
    }
}

// MARK: - Input

/// RFB pointer and key events as the Mac's own: clicks counted the way the
/// system counts them, the wheel as pixel scrolls, and text as Unicode so any
/// script types, whatever the keyboard layout.
nonisolated final class Input: @unchecked Sendable {
    private var buttons: UInt8 = 0
    private var point = CGPoint.zero
    private var flags: CGEventFlags = []
    private var lastDown: (time: TimeInterval, point: CGPoint, count: Int64) = (0, .zero, 0)
    private let source = CGEventSource(stateID: .hidSystemState)
    /// Where the picture's top-left is on the Mac: the display's, or the fitted window's.
    var origin: () -> CGPoint = { .zero }

    func pointer(mask: UInt8, x: Int, y: Int) {
        let origin = origin()
        point = CGPoint(x: origin.x + CGFloat(x), y: origin.y + CGFloat(y))
        let changed = mask ^ buttons
        for (bit, down, up, button) in [(UInt8(1), CGEventType.leftMouseDown, CGEventType.leftMouseUp, CGMouseButton.left),
                                        (4, .rightMouseDown, .rightMouseUp, .right)] where changed & bit != 0 {
            let pressed = mask & bit != 0
            if pressed {
                let now = ProcessInfo.processInfo.systemUptime
                let near = hypot(point.x - lastDown.point.x, point.y - lastDown.point.y) < 12
                lastDown = (now, point, now - lastDown.time < 0.35 && near ? lastDown.count + 1 : 1)
            }
            let event = CGEvent(mouseEventSource: source, mouseType: pressed ? down : up, mouseCursorPosition: point, mouseButton: button)
            event?.setIntegerValueField(.mouseEventClickState, value: lastDown.count)
            event?.flags = flags
            event?.post(tap: .cghidEventTap)
        }
        for (bit, dy, dx) in [(UInt8(8), Int32(24), Int32(0)), (16, -24, 0), (32, 0, 24), (64, 0, -24)]
        where mask & bit != 0 && buttons & bit == 0 {
            CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0)?.post(tap: .cghidEventTap)
        }
        if changed & 5 == 0 {
            let type: CGEventType = mask & 1 != 0 ? .leftMouseDragged : mask & 4 != 0 ? .rightMouseDragged : .mouseMoved
            let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: mask & 4 != 0 ? .right : .left)
            event?.flags = flags
            event?.post(tap: .cghidEventTap)
        }
        buttons = mask & 0x07
    }

    private static let modifiers: [UInt32: (CGEventFlags, CGKeyCode)] = [
        0xFFE1: (.maskShift, 56), 0xFFE2: (.maskShift, 60), 0xFFE3: (.maskControl, 59), 0xFFE4: (.maskControl, 62),
        0xFFE9: (.maskAlternate, 58), 0xFFEA: (.maskAlternate, 61), 0xFFE7: (.maskCommand, 55), 0xFFE8: (.maskCommand, 54),
        0xFFEB: (.maskCommand, 55), 0xFFEC: (.maskCommand, 54),
    ]

    private static let keys: [UInt32: CGKeyCode] = [
        0xFF0D: 36, 0xFF09: 48, 0xFF08: 51, 0xFF1B: 53, 0xFFFF: 117, 0xFF51: 123, 0xFF53: 124, 0xFF54: 125, 0xFF52: 126,
        0xFF50: 115, 0xFF57: 119, 0xFF55: 116, 0xFF56: 121, 0x20: 49,
        0xFFBE: 122, 0xFFBF: 120, 0xFFC0: 99, 0xFFC1: 118, 0xFFC2: 96, 0xFFC3: 97, 0xFFC4: 98, 0xFFC5: 100,
        0xFFC6: 101, 0xFFC7: 109, 0xFFC8: 103, 0xFFC9: 111,
    ]

    /// US-layout key codes, for characters typed with ⌘, ⌃ or ⌥ held: shortcuts follow key positions.
    private static let ansi: [Character: CGKeyCode] = {
        var map: [Character: CGKeyCode] = [:]
        let codes: [(String, [CGKeyCode])] = [
            ("asdfhgzxcv", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), ("bqweryt", [11, 12, 13, 14, 15, 16, 17]),
            ("123465", [18, 19, 20, 21, 22, 23]), ("=97-80]ou[ip", [24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35]),
            ("lj'k;\\,/nm.`", [37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 50]),
        ]
        for (characters, keyCodes) in codes { for (c, k) in zip(characters, keyCodes) { map[c] = k } }
        return map
    }()

    func key(_ keysym: UInt32, down: Bool) {
        if let (flag, code) = Self.modifiers[keysym] {
            if down { flags.insert(flag) } else { flags.remove(flag) }
            let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)
            event?.type = .flagsChanged
            event?.flags = flags
            event?.post(tap: .cghidEventTap)
            return
        }
        if let code = Self.keys[keysym] { return post(code, down) }
        let scalar = keysym >= 0x0100_0000 ? keysym - 0x0100_0000 : keysym
        guard let unicode = Unicode.Scalar(scalar) else { return }
        let character = Character(unicode)
        if !flags.isDisjoint(with: [.maskCommand, .maskControl, .maskAlternate]),
           let code = Self.ansi[Character(character.lowercased())] {
            return post(code, down)
        }
        guard down else { return }
        // Typed text goes as the characters themselves, so it does not depend on the Mac's layout.
        let units = Array(String(character).utf16)
        for pressed in [true, false] {
            let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: pressed)
            event?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
            event?.post(tap: .cghidEventTap)
        }
    }

    private func post(_ code: CGKeyCode, _ down: Bool) {
        let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)
        event?.flags = flags
        event?.post(tap: .cghidEventTap)
    }
}

// MARK: - A fitted window

/// The frontmost app's focused window, resized through Accessibility (public API, as Sill's
/// WindowSizer does) to the size a viewer's pane asks for, and put back where it was afterwards.
nonisolated final class FittedWindow: @unchecked Sendable {
    let element: AXUIElement
    let pid: pid_t
    let before: CGRect

    private init(element: AXUIElement, pid: pid_t, before: CGRect) {
        self.element = element
        self.pid = pid
        self.before = before
    }

    /// The frontmost app's window at `size` points, kept on `display`; nil when there is none or
    /// Accessibility is off. An app may keep a size of its own; `frame` says what it took.
    static func fit(_ size: CGSize, on display: CGRect, keeping old: FittedWindow?) -> FittedWindow? {
        guard AXIsProcessTrusted(), let app = NSWorkspace.shared.frontmostApplication,
              app.processIdentifier != getpid(), app.processIdentifier != parent else { return old }
        let pid = app.processIdentifier
        let axApp = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(axApp, 1)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &value) == .success
                || AXUIElementCopyAttributeValue(axApp, kAXMainWindowAttribute as CFString, &value) == .success,
              let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return old }
        let element = value as! AXUIElement
        AXUIElementSetMessagingTimeout(element, 1)
        // The same window keeps the frame it had before the first fit.
        let same = old.map { CFEqual($0.element, element) } ?? false
        if !same { old?.restore() }
        guard let current = frame(of: element) else { return nil }
        let window = FittedWindow(element: element, pid: pid, before: same ? old!.before : current)
        // Top-left stays, unless the new size would hang off the display.
        var origin = current.origin
        origin.x = max(display.minX, min(origin.x, display.maxX - size.width))
        origin.y = max(display.minY + 25, min(origin.y, display.maxY - size.height))
        window.set(CGRect(origin: origin, size: size))
        return window
    }

    var frame: CGRect? { Self.frame(of: element) }

    func restore() { set(before) }

    private func set(_ rect: CGRect) {
        var origin = rect.origin, size = rect.size
        if let position = AXValueCreate(.cgPoint, &origin) { AXUIElementSetAttributeValue(element, kAXPositionAttribute as CFString, position) }
        if let value = AXValueCreate(.cgSize, &size) { AXUIElementSetAttributeValue(element, kAXSizeAttribute as CFString, value) }
    }

    private static func frame(of element: AXUIElement) -> CGRect? {
        var position: CFTypeRef?, size: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &position) == .success,
              AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &size) == .success,
              let position, let size else { return nil }
        var origin = CGPoint.zero, extent = CGSize.zero
        AXValueGetValue(position as! AXValue, .cgPoint, &origin)
        AXValueGetValue(size as! AXValue, .cgSize, &extent)
        return CGRect(origin: origin, size: extent)
    }

    /// The capture's window for this one: the app's on-screen window whose frame is nearest.
    func captureWindow() -> SCWindow? {
        let done = DispatchSemaphore(value: 0)
        nonisolated(unsafe) var windows: [SCWindow] = []
        SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { content, _ in
            windows = content?.windows ?? []
            done.signal()
        }
        done.wait()
        guard let frame else { return nil }
        return windows
            .filter { $0.owningApplication?.processID == pid && $0.windowLayer == 0 }
            .min { abs($0.frame.minX - frame.minX) + abs($0.frame.minY - frame.minY) < abs($1.frame.minX - frame.minX) + abs($1.frame.minY - frame.minY) }
    }
}

// MARK: - One viewer

nonisolated final class Viewer: NSObject, SCStreamOutput, @unchecked Sendable {
    private let connection: Connection
    private let display: SCDisplay
    private var width: Int
    private var height: Int
    /// Set while a window, not the whole display, is shown.
    private var fitted: FittedWindow?
    /// The next update starts with the picture's new size.
    private var resized = false
    private let lock = NSLock()
    private let input = Input()
    private var encoder: Encoder?
    private var stream: SCStream?
    private var latest: (image: CVPixelBuffer, time: CMTime)?
    private var fresh = false
    private var wanted = false
    private var keyframe = true
    private var encoding = false
    private let queue = DispatchQueue(label: "mac-screen-host.capture")

    init(connection: Connection, display: SCDisplay) {
        self.connection = connection
        self.display = display
        width = display.width & ~1
        height = display.height & ~1
        super.init()
        let displayOrigin = CGDisplayBounds(display.displayID).origin
        input.origin = { [weak self] in self?.fittedOrigin() ?? displayOrigin }
    }

    private func fittedOrigin() -> CGPoint? {
        lock.lock()
        let window = fitted
        lock.unlock()
        return window?.frame?.origin
    }

    func run() {
        guard handshake() else { return finish() }
        startCapture()
        while let type = connection.read(1)?.first {
            switch type {
            case 0: guard connection.read(19) != nil else { return finish() }
            case 2:
                guard let head = connection.read(3) else { return finish() }
                let count = Int(head[1]) << 8 | Int(head[2])
                if count > 0, connection.read(count * 4) == nil { return finish() }
            case 3:
                guard let request = connection.read(9) else { return finish() }
                lock.lock()
                wanted = true
                if request[0] == 0 { keyframe = true; fresh = latest != nil }
                lock.unlock()
                pump()
            case 4:
                guard let event = connection.read(7) else { return finish() }
                input.key(UInt32(event[3]) << 24 | UInt32(event[4]) << 16 | UInt32(event[5]) << 8 | UInt32(event[6]), down: event[0] != 0)
            case 5:
                guard let event = connection.read(5) else { return finish() }
                input.pointer(mask: event[0], x: Int(event[1]) << 8 | Int(event[2]), y: Int(event[3]) << 8 | Int(event[4]))
            case 251:
                // SetDesktopSize: screen 1 at w×h fits the frontmost window to it; anything else shows the display.
                guard let head = connection.read(7) else { return finish() }
                let count = Int(head[5])
                guard count <= 16, let screens = connection.read(count * 16) else { return finish() }
                let w = Int(head[1]) << 8 | Int(head[2]), h = Int(head[3]) << 8 | Int(head[4])
                let id = count > 0 ? Int(screens[0]) << 24 | Int(screens[1]) << 16 | Int(screens[2]) << 8 | Int(screens[3]) : 0
                show(window: id == 1 && w >= 64 && h >= 64 ? CGSize(width: w, height: h) : nil)
            case 6:
                guard let head = connection.read(7) else { return finish() }
                let length = Int(head[3]) << 24 | Int(head[4]) << 16 | Int(head[5]) << 8 | Int(head[6])
                guard length < 1 << 20, connection.read(length) != nil else { return finish() }
            default:
                return finish()
            }
        }
        finish()
    }

    private func handshake() -> Bool {
        connection.send(Array("RFB 003.008\n".utf8))
        guard connection.read(12) != nil else { return false }
        connection.send([1, 1])
        guard connection.read(1) == [1] else { return false }
        connection.send(be32(0))
        guard connection.read(1) != nil else { return false }
        // The name tells a Nuphos viewer it can ask for one window fitted to its pane (SetDesktopSize).
        let name = Array("Nuphos Mac".utf8)
        connection.send(be16(width) + be16(height) + [32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0] + be32(name.count) + name)
        return true
    }

    private func startCapture(window: SCWindow? = nil) {
        let config = SCStreamConfiguration()
        config.width = width
        config.height = height
        config.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
        config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        config.queueDepth = 5
        config.showsCursor = true
        config.colorSpaceName = CGColorSpace.sRGB
        let filter = window.map { SCContentFilter(desktopIndependentWindow: $0) } ?? SCContentFilter(display: display, excludingWindows: [])
        let stream = SCStream(filter: filter, configuration: config, delegate: nil)
        do {
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        } catch {
            fputs("mac-screen-host: capture output failed: \(error)\n", stderr)
            return
        }
        lock.lock()
        self.stream = stream
        encoder = Encoder(width: width, height: height)
        latest = nil
        keyframe = true
        lock.unlock()
        stream.startCapture { error in
            if let error { fputs("mac-screen-host: capture failed: \(error)\n", stderr) }
        }
    }

    /// One window fitted to `size` points, or with nil the whole display; the stream restarts at the
    /// new size, which the next update announces.
    private func show(window size: CGSize?) {
        let bounds = CGDisplayBounds(display.displayID)
        var window: SCWindow?
        lock.lock()
        let old = fitted
        lock.unlock()
        var next: FittedWindow?
        if let size {
            next = FittedWindow.fit(size, on: bounds, keeping: old)
            usleep(150_000) // The app takes its new size.
            window = next?.captureWindow()
            if window == nil { next = nil }
        }
        if next == nil { old?.restore() }
        let frame = window.map(\.frame) ?? bounds
        stream?.stopCapture { _ in }
        fittedLock.lock()
        fittedWindows[ObjectIdentifier(self)] = next
        fittedLock.unlock()
        lock.lock()
        fitted = next
        width = max(Int(frame.width.rounded()) & ~1, 2)
        height = max(Int(frame.height.rounded()) & ~1, 2)
        resized = true
        lock.unlock()
        startCapture(window: window)
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, let image = CMSampleBufferGetImageBuffer(sample),
              let info = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let status = (info.first?[.status] as? Int).flatMap(SCFrameStatus.init(rawValue:)), status == .complete else { return }
        lock.lock()
        guard stream === self.stream else { return lock.unlock() }
        latest = (image, CMSampleBufferGetPresentationTimeStamp(sample))
        fresh = true
        lock.unlock()
        pump()
    }

    /// Encodes the newest frame when the viewer wants one and none is in flight.
    private func pump() {
        lock.lock()
        guard wanted, fresh, !encoding, let frame = latest, let encoder else { return lock.unlock() }
        wanted = false
        fresh = false
        encoding = true
        let key = keyframe
        keyframe = false
        let announce = resized
        resized = false
        let (w, h) = (width, height)
        lock.unlock()
        encoder.encode(frame.image, at: frame.time, keyframe: key) { [self] data in
            if let data {
                // DesktopSize first when the picture changed size, then the frame (flags 1: a new stream).
                let size: [UInt8] = announce ? be16(0) + be16(0) + be16(w) + be16(h) + be32(-223) : []
                connection.send([0, 0] + be16(announce ? 2 : 1) + size + be16(0) + be16(0) + be16(w) + be16(h) + be32(50)
                                + be32(data.count) + be32(announce ? 1 : 0) + data)
            } else if announce {
                lock.lock()
                resized = true
                lock.unlock()
            }
            lock.lock()
            encoding = false
            if data == nil { wanted = true; keyframe = true }
            lock.unlock()
            pump()
        }
    }

    private func finish() {
        stream?.stopCapture { _ in }
        lock.lock()
        let window = fitted
        fitted = nil
        lock.unlock()
        window?.restore()
        fittedLock.lock()
        fittedWindows[ObjectIdentifier(self)] = nil
        fittedLock.unlock()
        connection.close()
    }
}

// MARK: - Main

unlink(socketPath)
let server = socket(AF_UNIX, SOCK_STREAM, 0)
var address = sockaddr_un()
address.sun_family = sa_family_t(AF_UNIX)
let pathBytes = Array(socketPath.utf8)
guard pathBytes.count < MemoryLayout.size(ofValue: address.sun_path) else { fail("socket path too long") }
withUnsafeMutableBytes(of: &address.sun_path) { raw in
    raw.copyBytes(from: pathBytes)
    raw[pathBytes.count] = 0
}
let bound = withUnsafePointer(to: &address) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(server, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
}
guard bound == 0, listen(server, 4) == 0 else { fail("cannot listen on \(socketPath): \(String(cString: strerror(errno)))") }
chmod(socketPath, 0o600)
print("listening on \(socketPath)")

// With nobody watching for IDLE seconds the host exits; Nuphos starts it again for the next viewer.
let idle: Double = 60
nonisolated(unsafe) var viewers = 0
nonisolated(unsafe) var idleExit: DispatchWorkItem?

func viewerCount(_ change: Int) {
    DispatchQueue.main.async {
        viewers += change
        idleExit?.cancel()
        guard viewers == 0 else { return }
        let item = DispatchWorkItem { exit(0) }
        idleExit = item
        DispatchQueue.main.asyncAfter(deadline: .now() + idle, execute: item)
    }
}
viewerCount(0)

Thread.detachNewThread {
    while true {
        let fd = accept(server, nil, nil)
        guard fd >= 0 else { continue }
        // Another process of the same user would otherwise use Nuphos's Screen Recording and Accessibility.
        var peer: pid_t = 0
        var size = socklen_t(MemoryLayout<pid_t>.size)
        guard getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &peer, &size) == 0, peer == parent else {
            Darwin.close(fd)
            continue
        }
        Task {
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first else {
                    Darwin.close(fd)
                    return
                }
                let viewer = Viewer(connection: Connection(fd: fd), display: display)
                Thread.detachNewThread {
                    viewerCount(+1)
                    viewer.run()
                    viewerCount(-1)
                }
            } catch {
                fputs("mac-screen-host: no screen: \(error)\n", stderr)
                Darwin.close(fd)
            }
        }
    }
}
dispatchMain()
