import Foundation

/// The remote screen as 32-bit pixels, laid out as the client's pixel format
/// asks the server for them: little-endian `0x00RRGGBB`, which is BGRX in
/// memory, the layout Core Graphics draws without converting.
nonisolated struct RFBFramebuffer {
    private(set) var width: Int
    private(set) var height: Int
    var pixels: [UInt32]

    init(width: Int, height: Int) {
        self.width = width
        self.height = height
        pixels = [UInt32](repeating: 0, count: width * height)
    }

    mutating func resize(width: Int, height: Int) {
        self = RFBFramebuffer(width: width, height: height)
    }

    func contains(x: Int, y: Int, width w: Int, height h: Int) -> Bool {
        x >= 0 && y >= 0 && w >= 0 && h >= 0 && x + w <= width && y + h <= height
    }

    mutating func fill(x: Int, y: Int, width w: Int, height h: Int, color: UInt32) {
        for row in y..<(y + h) {
            let start = row * width + x
            pixels.replaceSubrange(start..<(start + w), with: repeatElement(color, count: w))
        }
    }

    mutating func copy(fromX sx: Int, fromY sy: Int, toX x: Int, toY y: Int, width w: Int, height h: Int) {
        let rows = sy < y ? Array((0..<h).reversed()) : Array(0..<h)
        for row in rows {
            let from = (sy + row) * width + sx
            let to = (y + row) * width + x
            let line = Array(pixels[from..<(from + w)])
            pixels.replaceSubrange(to..<(to + w), with: line)
        }
    }

    /// Writes `w × h` pixels given row by row.
    mutating func put(x: Int, y: Int, width w: Int, height h: Int, _ source: [UInt32]) {
        for row in 0..<h {
            let to = (y + row) * width + x
            pixels.replaceSubrange(to..<(to + w), with: source[(row * w)..<(row * w + w)])
        }
    }
}

/// Pixel data decoders for the encodings the client asks for.
nonisolated enum RFBDecode {
    struct Corrupt: Error {}

    /// A 4-byte pixel (B, G, R, X) as it arrives in Raw and Cursor data.
    static func pixel(_ bytes: ArraySlice<UInt8>, at offset: Int) -> UInt32 {
        let i = bytes.startIndex + offset
        return UInt32(bytes[i]) | UInt32(bytes[i + 1]) << 8 | UInt32(bytes[i + 2]) << 16
    }

    static func raw(_ bytes: [UInt8], count: Int) -> [UInt32] {
        (0..<count).map { pixel(bytes[...], at: $0 * 4) }
    }

    /// Decodes the inflated data of one ZRLE rectangle: 64×64 tiles, each raw,
    /// solid, palette-packed or run-length encoded, with 3-byte pixels.
    static func zrle(_ data: [UInt8], width: Int, height: Int) throws -> [UInt32] {
        var output = [UInt32](repeating: 0, count: width * height)
        var at = 0

        func byte() throws -> Int {
            guard at < data.count else { throw Corrupt() }
            defer { at += 1 }
            return Int(data[at])
        }
        func cpixel() throws -> UInt32 {
            guard at + 3 <= data.count else { throw Corrupt() }
            defer { at += 3 }
            return UInt32(data[at]) | UInt32(data[at + 1]) << 8 | UInt32(data[at + 2]) << 16
        }
        func runLength() throws -> Int {
            var length = 1
            while true {
                let next = try byte()
                length += next
                if next != 255 { return length }
            }
        }

        for tileY in stride(from: 0, to: height, by: 64) {
            for tileX in stride(from: 0, to: width, by: 64) {
                let w = min(64, width - tileX), h = min(64, height - tileY)
                let subencoding = try byte()
                func set(_ i: Int, _ color: UInt32) {
                    output[(tileY + i / w) * width + tileX + i % w] = color
                }
                switch subencoding {
                case 0:
                    for i in 0..<(w * h) { set(i, try cpixel()) }
                case 1:
                    let color = try cpixel()
                    for i in 0..<(w * h) { set(i, color) }
                case 2...16:
                    let palette = try (0..<subencoding).map { _ in try cpixel() }
                    let bitsPerIndex = subencoding == 2 ? 1 : subencoding <= 4 ? 2 : 4
                    let mask = (1 << bitsPerIndex) - 1
                    for row in 0..<h {
                        var current = 0, left = 0
                        for column in 0..<w {
                            if left == 0 { current = try byte(); left = 8 }
                            left -= bitsPerIndex
                            let index = (current >> left) & mask
                            guard index < palette.count else { throw Corrupt() }
                            set(row * w + column, palette[index])
                        }
                    }
                case 128:
                    var i = 0
                    while i < w * h {
                        let color = try cpixel()
                        let length = try runLength()
                        guard i + length <= w * h else { throw Corrupt() }
                        for j in i..<(i + length) { set(j, color) }
                        i += length
                    }
                case 130...255:
                    let palette = try (0..<(subencoding - 128)).map { _ in try cpixel() }
                    var i = 0
                    while i < w * h {
                        let index = try byte()
                        guard index & 0x7F < palette.count else { throw Corrupt() }
                        let length = index & 0x80 != 0 ? try runLength() : 1
                        guard i + length <= w * h else { throw Corrupt() }
                        for j in i..<(i + length) { set(j, palette[index & 0x7F]) }
                        i += length
                    }
                default:
                    throw Corrupt()
                }
            }
        }
        return output
    }
}

/// The remote pointer's shape from the Cursor pseudo-encoding, as
/// premultiplied BGRA pixels with its hot spot.
nonisolated struct RFBCursor: Equatable {
    let width: Int
    let height: Int
    let hotX: Int
    let hotY: Int
    let pixels: [UInt32]

    init(width: Int, height: Int, hotX: Int, hotY: Int, colors: [UInt8], mask: [UInt8]) {
        self.width = width
        self.height = height
        self.hotX = hotX
        self.hotY = hotY
        let stride = (width + 7) / 8
        pixels = (0..<(width * height)).map { i in
            let x = i % width, y = i / width
            let visible = mask[y * stride + x / 8] & (0x80 >> UInt8(x % 8)) != 0
            return visible ? RFBDecode.pixel(colors[...], at: i * 4) | 0xFF00_0000 : 0
        }
    }
}
