import Foundation

/// The desktop viewer's protocol pieces, without UIKit: zlib, ZRLE, the RFB
/// handshake and update loop against a scripted server, the Diffie-Hellman
/// arithmetic and keysyms.
@main
struct DesktopTests {
    static func main() async throws {
        try inflate()
        try zrle()
        try await handshake()
        try await limits()
        try await signInRefused()
        try await video()
        try await fitWindow()
        h264()
        keysyms()
        print("Desktop viewer tests passed")
    }

    static func hex(_ text: some StringProtocol) -> [UInt8] {
        var bytes: [UInt8] = []
        var index = text.startIndex
        while index < text.endIndex {
            let next = text.index(index, offsetBy: 2)
            bytes.append(UInt8(text[index..<next], radix: 16)!)
            index = next
        }
        return bytes
    }

    /// One zlib stream with sync and partial flushes, fed in uneven pieces that ignore the flush points.
    static func inflate() throws {
        let lines = try String(contentsOfFile: "tests/fixtures/desktop-zlib.txt", encoding: .utf8).split(separator: "\n")
        let expected = lines[0].split(separator: " ")
        let stream = lines.dropFirst().flatMap(hex)
        let inflater = ZlibStream()
        var output: [UInt8] = []
        var offset = 0
        var size = 1
        while offset < stream.count {
            let end = min(stream.count, offset + size)
            output += try inflater.inflate(Array(stream[offset..<end]))
            offset = end
            size = size * 7 % 1013 + 1
        }
        let fnv = output.reduce(UInt64(0xcbf2_9ce4_8422_2325)) { ($0 ^ UInt64($1)) &* 0x100_0000_01b3 }
        precondition(output.count == Int(expected[0])! && fnv == UInt64(expected[1])!, "inflated bytes differ")
    }

    static let red: UInt32 = 0xFF0000, blue: UInt32 = 0x0000FF, green: UInt32 = 0x00FF00

    /// A 70×3 rectangle: a 64-wide palette-RLE tile, then a 6-wide packed palette tile.
    static let zrleRect = hex("789c6a6260f8ff9f81a12185b1219289e13f1032ac08f903000000ffff")

    static func expectedRect() -> [UInt32] {
        var pixels = [UInt32](repeating: 0, count: 70 * 3)
        let tileA = [UInt32](repeating: red, count: 101) + [blue] + [UInt32](repeating: red, count: 90)
        let tileB: [UInt32] = [blue, green, blue, green, blue, green, green, blue, green, blue, green, blue] + [UInt32](repeating: blue, count: 6)
        for i in 0..<192 { pixels[(i / 64) * 70 + i % 64] = tileA[i] }
        for i in 0..<18 { pixels[(i / 6) * 70 + 64 + i % 6] = tileB[i] }
        return pixels
    }

    static func zrle() throws {
        let inflater = ZlibStream()
        let rect = try RFBDecode.zrle(try inflater.inflate(zrleRect), width: 70, height: 3)
        precondition(rect == expectedRect())
        let solid = try RFBDecode.zrle([1, 0x00, 0xFF, 0x00], width: 3, height: 2)
        precondition(solid == [UInt32](repeating: green, count: 6))
        let plainRLE = try RFBDecode.zrle([128, 0xFF, 0, 0, 2, 0, 0, 0xFF, 0], width: 4, height: 1)
        precondition(plainRLE == [blue, blue, blue, red])
        let raw = try RFBDecode.zrle([0, 0xFF, 0, 0, 0, 0xFF, 0], width: 2, height: 1)
        precondition(raw == [blue, green])
        precondition((try? RFBDecode.zrle([128, 0, 0, 0, 9], width: 2, height: 1)) == nil, "A run past the tile is corrupt")
        precondition((try? ZlibStream().inflate(zrleRect, limit: 10)) == nil, "More output than the rectangle can hold is refused")
    }

    final class Recorder: @unchecked Sendable {
        var sent: [UInt8] = []
        var frames: [RFBFramebuffer] = []
        var cursor: RFBCursor?
        var pointer: (Int, Int)?
        var size: (Int, Int)?
        var video: [(data: [UInt8], flags: Int)] = []
        var updates: [(bytes: Int, consumed: Int)] = []
        var name: String?
        var resized: (Int, Int)?
    }

    static func be16(_ value: Int) -> [UInt8] { [UInt8(value >> 8), UInt8(value & 0xFF)] }
    static func be32(_ value: Int) -> [UInt8] { [24, 16, 8, 0].map { UInt8(truncatingIfNeeded: value >> $0) } }
    static func rect(_ x: Int, _ y: Int, _ w: Int, _ h: Int, _ encoding: Int) -> [UInt8] {
        be16(x) + be16(y) + be16(w) + be16(h) + be32(encoding)
    }

    /// A TigerVNC-like server: no security, an 80×4 screen, then one update
    /// with every encoding the client asks for, split across odd chunks.
    static func handshake() async throws {
        let recorder = Recorder()
        let client = RFBClient(send: { recorder.sent += $0 }, handlers: .init(
            ready: { w, h in recorder.size = (w, h) },
            frame: { recorder.frames.append($0) },
            cursor: { recorder.cursor = $0 },
            pointer: { recorder.pointer = ($0, $1) },
            clipboard: { _ in },
            update: { bytes, _, _, consumed in recorder.updates.append((bytes, consumed)) }
        ))
        var server = Array("RFB 003.008\n".utf8) + [1, 1] + be32(0)
        server += be16(80) + be16(4) + [UInt8](repeating: 0, count: 16) + be32(3) + Array("Box".utf8)
        server += [0, 0] + be16(5)
        server += rect(0, 0, 70, 3, 16) + be32(zrleRect.count) + zrleRect
        server += rect(70, 0, 2, 1, 0) + [0, 0, 0xFF, 0, 0, 0xFF, 0, 0]
        server += rect(0, 3, 70, 1, 1) + be16(0) + be16(0)
        server += rect(1, 1, 2, 2, -239) + [UInt8](repeating: 0xFF, count: 16) + [0x80, 0x40]
        server += rect(40, 2, 0, 0, -232)
        let (chunks, input) = AsyncThrowingStream<[UInt8], Error>.makeStream()
        var offset = 0
        while offset < server.count {
            let end = min(server.count, offset + 5)
            input.yield(Array(server[offset..<end]))
            offset = end
        }
        input.finish()
        do {
            try await client.run(RFBByteStream(chunks))
            preconditionFailure("The stream ended, so the client must throw")
        } catch is RFBByteStream.Closed {}

        precondition(recorder.size! == (80, 4))
        precondition(recorder.updates.count == 1 && recorder.updates[0].consumed == server.count, "One update, reported once all its bytes were read")
        var expected = Array("RFB 003.008\n".utf8) + [1, 1] + RFBClient.pixelFormat
        expected += [2, 0] + be16(RFBClient.encodings.count) + RFBClient.encodings.flatMap { be32(Int($0)) }
        expected += RFBClient.updateRequest(incremental: false, width: 80, height: 4)
        expected += RFBClient.updateRequest(incremental: true, width: 80, height: 4)
        precondition(recorder.sent == expected, "client messages differ")

        let frame = recorder.frames.last!
        let rect = expectedRect()
        for y in 0..<3 {
            precondition(Array(frame.pixels[(y * 80)..<(y * 80 + 70)]) == Array(rect[(y * 70)..<(y * 70 + 70)]))
        }
        precondition(frame.pixels[70] == red && frame.pixels[71] == green)
        precondition(Array(frame.pixels[240..<310]) == Array(frame.pixels[0..<70]), "CopyRect copies row 0 to row 3")
        precondition(recorder.cursor!.pixels == [0xFFFF_FFFF, 0, 0, 0xFFFF_FFFF] && recorder.cursor!.hotX == 1)
        precondition(recorder.pointer! == (40, 2))
    }

    /// A server that announces a screen larger than the cap is refused before any allocation.
    static func limits() async throws {
        let client = RFBClient(send: { _ in }, handlers: .init(
            ready: { _, _ in }, frame: { _ in },
            cursor: { _ in }, pointer: { _, _ in }, clipboard: { _ in }
        ))
        let server = Array("RFB 003.008\n".utf8) + [1, 1] + be32(0) + be16(65535) + be16(65535)
        let (chunks, input) = AsyncThrowingStream<[UInt8], Error>.makeStream()
        input.yield(server)
        input.finish()
        do {
            try await client.run(RFBByteStream(chunks))
            preconditionFailure("A 65535×65535 screen must be refused")
        } catch RFBClient.Failure.unexpected {}
    }

    static func quietClient(_ recorder: Recorder) -> RFBClient {
        RFBClient(send: { recorder.sent += $0 }, handlers: .init(
            ready: { w, h in recorder.size = (w, h) }, frame: { recorder.frames.append($0) },
            cursor: { _ in }, pointer: { _, _ in }, clipboard: { _ in },
            video: { data, flags in recorder.video.append((data, flags)) }
        ))
    }

    static func run(_ client: RFBClient, against server: [UInt8]) async throws {
        let (chunks, input) = AsyncThrowingStream<[UInt8], Error>.makeStream()
        input.yield(server)
        input.finish()
        try await client.run(RFBByteStream(chunks))
    }

    /// A computer that only offers an account sign-in (Screen Sharing behind an older Nuphos) is refused, not asked.
    static func signInRefused() async throws {
        let recorder = Recorder()
        do {
            try await run(quietClient(recorder), against: Array("RFB 003.889\n".utf8) + [1, 30])
            preconditionFailure("Only security None is accepted")
        } catch RFBClient.Failure.needsSignIn {}
        precondition(recorder.sent == Array("RFB 003.008\n".utf8), "Nothing is answered to a sign-in it cannot do")
    }

    /// Open H.264 rectangles go to the video handler, and an update of only video paints no pixels.
    static func video() async throws {
        let recorder = Recorder()
        let payload: [UInt8] = [0, 0, 0, 1, 0x65, 1, 2, 3]
        var server = Array("RFB 003.008\n".utf8) + [1, 1] + be32(0)
        server += be16(16) + be16(8) + [UInt8](repeating: 0, count: 16) + be32(0)
        server += [0, 0] + be16(1) + rect(0, 0, 16, 8, 50) + be32(payload.count) + be32(1) + payload
        do {
            try await run(quietClient(recorder), against: server)
        } catch is RFBByteStream.Closed {}
        precondition(recorder.video.count == 1 && recorder.video[0].data == payload && recorder.video[0].flags == 1)
        precondition(recorder.frames.isEmpty, "No pixel frame for an update that only carried video")
        precondition(RFBClient.encodings.first == 50, "Open H.264 is asked for first")
    }

    /// A Mac's Nuphos host names itself, a fitted window's new size comes as DesktopSize before its
    /// frame, and the request for one is SetDesktopSize with screen 1.
    static func fitWindow() async throws {
        let recorder = Recorder()
        var handlers = RFBClient.Handlers(
            ready: { _, _ in }, frame: { _ in }, cursor: { _ in }, pointer: { _, _ in }, clipboard: { _ in },
            video: { data, flags in recorder.video.append((data, flags)) }
        )
        handlers.named = { recorder.name = $0 }
        handlers.resized = { w, h in recorder.resized = (w, h) }
        let client = RFBClient(send: { recorder.sent += $0 }, handlers: handlers)
        let payload: [UInt8] = [0, 0, 0, 1, 0x65, 1]
        var server = Array("RFB 003.008\n".utf8) + [1, 1] + be32(0)
        server += be16(16) + be16(8) + [UInt8](repeating: 0, count: 16) + be32(10) + Array("Nuphos Mac".utf8)
        server += [0, 0] + be16(2) + rect(0, 0, 32, 20, -223) + rect(0, 0, 32, 20, 50) + be32(payload.count) + be32(1) + payload
        do {
            try await run(client, against: server)
        } catch is RFBByteStream.Closed {}
        precondition(recorder.name.map(RFBClient.fitsWindows) == true, "The Mac host's name says it fits windows")
        precondition(recorder.resized.map { $0 == (32, 20) } == true && recorder.video.count == 1, "The frame fits the new size")
        precondition(!RFBClient.fitsWindows("Box"))
        let fit = RFBClient.setDesktopSize(width: 600, height: 400, window: true)
        precondition(fit == [251, 0] + be16(600) + be16(400) + [1, 0] + be32(1) + be16(0) + be16(0) + be16(600) + be16(400) + be32(0))
        precondition(RFBClient.setDesktopSize(width: 600, height: 400, window: false)[11] == 0, "Screen 0 is the whole display")
    }

    /// Annex B parsing, and that deltas wait for a keyframe with parameter sets.
    static func h264() {
        let sps = hex("27640028ac56806c0237ee6e04040404"), pps = hex("28ee3cb0")
        let start: [UInt8] = [0, 0, 0, 1]
        let units = H264Stream.units(start + sps + [0, 0, 1] + pps + start + [0x65, 9, 9])
        precondition(units == [sps, pps, [0x65, 9, 9]], "Three- and four-byte start codes both split units")
        let stream = H264Stream()
        precondition(stream.sample(start + [0x41, 1, 2]) == nil, "A delta before any keyframe is dropped")
        precondition(stream.sample(start + sps + start + pps + start + [0x65, 1, 2]) != nil, "A keyframe with SPS and PPS makes a sample")
        precondition(stream.sample(start + [0x41, 3, 4]) != nil, "Deltas follow once a keyframe came")
        stream.reset()
        precondition(stream.sample(start + [0x41, 5, 6]) == nil, "After a reset, deltas wait again")
    }

    static func keysyms() {
        precondition(RFBKeysym.character("a") == 0x61 && RFBKeysym.character("é") == 0xE9)
        precondition(RFBKeysym.character("中") == 0x0100_4E2D)
        precondition(RFBKeysym.character("\n") == RFBKeysym.return && RFBKeysym.character("\u{8}") == RFBKeysym.backspace)
        precondition(RFBKeysym.function(12) == 0xFFC9)
        precondition(RFBClient.pointer(buttons: 0xFF, x: -3, y: 9) == [5, 0x7F, 0, 0, 0, 9], "Bit 7 would make the relay read an extended pointer event")
    }
}
