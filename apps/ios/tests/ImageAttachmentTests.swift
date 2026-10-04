import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

enum ImageAttachmentTests {
    static func run() {
        for (width, height) in [(4032, 3024), (3024, 4032), (4704, 4704), (800, 8000)] {
            let output = ImageAttachment.jpeg(from: fixture(width: width, height: height))!
            let image = decode(output)
            precondition(image.width == width && image.height == height, "preserve full-resolution photos and long screenshots")
        }
        let small = decode(ImageAttachment.jpeg(from: fixture(width: 320, height: 240))!)
        precondition(small.width == 320 && small.height == 240)
        let rotated = decode(ImageAttachment.jpeg(from: fixture(width: 4032, height: 3024, orientation: 6))!)
        precondition(rotated.width == 3024 && rotated.height == 4032, "normalize EXIF without downscaling")
        let png = decode(ImageAttachment.jpeg(from: fixture(width: 2400, height: 1200, type: .png))!)
        precondition(png.width == 2400 && png.height == 1200)
        precondition(ImageAttachment.jpeg(from: Data("not an image".utf8)) == nil)

        let noisy = ImageAttachment.jpeg(from: fixture(width: 1568, height: 1568, type: .png, noise: true))!
        precondition(noisy.count > 256 * 1024, "large readable images must not have a per-file byte cap")
        let untouched = try! ChatPayload.fitImages([noisy], encode: encode)
        precondition(untouched == [noisy], "a message within budget must not be recompressed")

        let count = ChatPayload.maxBytes / (noisy.count * 4 / 3) + 1
        let originals = Array(repeating: noisy, count: count)
        precondition(try! encode(originals).count > ChatPayload.maxBytes)
        let fitted = try! ChatPayload.fitImages(originals, encode: encode)
        precondition(fitted.count == originals.count)
        precondition(fitted[0].count < noisy.count, "only over-budget messages reduce quality")
        precondition(try! encode(fitted).count <= ChatPayload.maxBytes - 64 * 1024)
        precondition(decode(fitted[0]).width == 1568 && decode(fitted[0]).height == 1568, "compression must not shrink text")

        // Even the lowest allowed quality cannot fit when text exhausts the budget.
        do {
            _ = try ChatPayload.fitImages([noisy]) { _ in Data(count: ChatPayload.maxBytes) }
            preconditionFailure("ask to split instead of shrinking further")
        } catch is ChatPayload.TooLarge {} catch { preconditionFailure("unexpected error") }
        precondition(originals.allSatisfy { $0 == noisy }, "attempts must not mutate the draft")
        try! ChatPayload.check(Data(count: ChatPayload.maxBytes))
        do {
            try ChatPayload.check(Data(count: ChatPayload.maxBytes + 1))
            preconditionFailure("reject over-budget payloads")
        } catch is ChatPayload.TooLarge {} catch { preconditionFailure("unexpected error") }
        do {
            _ = try ChatPayload.fitImages([]) { _ in Data(count: ChatPayload.maxBytes) }
            preconditionFailure("text-only payloads also need envelope headroom")
        } catch is ChatPayload.TooLarge {} catch { preconditionFailure("unexpected error") }
        print("Full-resolution images, whole-request quality budget, orientation and byte boundaries passed")
    }

    private static func encode(_ images: [Data]) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        return try encoder.encode(["images": images.map { "data:image/jpeg;base64," + $0.base64EncodedString() }, "text": ["中文\\\"\n"]])
    }

    private static func decode(_ data: Data) -> CGImage {
        let source = CGImageSourceCreateWithData(data as CFData, nil)!
        precondition(CGImageSourceGetType(source)! as String == UTType.jpeg.identifier)
        return CGImageSourceCreateImageAtIndex(source, 0, nil)!
    }

    private static func fixture(width: Int, height: Int, orientation: Int = 1, type: UTType = .jpeg, noise: Bool = false) -> Data {
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        context.setFillColor(CGColor(red: 0.2, green: 0.5, blue: 0.8, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
        if noise {
            let bytes = context.data!.assumingMemoryBound(to: UInt8.self)
            var seed: UInt32 = 42
            for i in 0..<(width * height * 4) {
                seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5
                bytes[i] = UInt8(truncatingIfNeeded: seed)
            }
        }
        let output = NSMutableData()
        let destination = CGImageDestinationCreateWithData(output, type.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, context.makeImage()!, [kCGImagePropertyOrientation: orientation] as CFDictionary)
        precondition(CGImageDestinationFinalize(destination))
        return output as Data
    }
}
