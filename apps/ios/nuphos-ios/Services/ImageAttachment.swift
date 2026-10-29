import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Normalize picker formats and EXIF orientation without shrinking text or screenshots.
enum ImageAttachment {
    static func jpeg(from data: Data, quality: Double = 0.95) -> Data? {
        guard let image = image(from: data) else { return nil }
        return encode(image, quality: quality)
    }

    /// A profile photo: the centered square of a picked image, at most 1024px.
    /// The backend re-encodes it to a 256px WebP.
    static func avatar(from data: Data) -> Data? {
        guard let image = image(from: data, maxPixelSize: 1024) else { return nil }
        let side = min(image.width, image.height)
        let square = CGRect(x: (image.width - side) / 2, y: (image.height - side) / 2, width: side, height: side)
        guard let cropped = image.cropping(to: square) else { return nil }
        return encode(cropped, quality: 0.9)
    }

    /// The upright image, scaled down to `maxPixelSize` when given.
    private static func image(from data: Data, maxPixelSize: Int? = nil) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int else { return nil }
        return CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: min(max(width, height), maxPixelSize ?? .max),
        ] as CFDictionary)
    }

    private static func encode(_ image: CGImage, quality: Double) -> Data? {
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return output as Data
    }
}

/// Whole JSON request budget, including base64. Proxies may still impose a lower limit.
enum ChatPayload {
    static let maxBytes = 20_000_000
    static let tooLargeMessage = "This message is too large to send. Remove some attachments or send them in separate messages. If it still fails, try a new agent."

    struct TooLarge: LocalizedError {
        var errorDescription: String? { ChatPayload.tooLargeMessage }
    }

    static func check(_ data: Data, reserve: Int = 0) throws {
        if data.count > maxBytes - reserve { throw TooLarge() }
    }

    /// Keep the high-quality images unchanged whenever the whole message fits.
    /// Never shrink dimensions or keep lowering quality just to squeeze it in.
    static func fitImages(_ images: [Data], encode: ([Data]) throws -> Data) throws -> [Data] {
        let budget = maxBytes - 64 * 1024 // Request envelope and file-transfer instruction.
        if try encode(images).count <= budget { return images }
        guard !images.isEmpty else { throw TooLarge() }
        for quality in [0.85, 0.75] {
            // Always encode from the original high-quality input, not the previous attempt.
            let candidate = images.map { original in
                guard let compressed = ImageAttachment.jpeg(from: original, quality: quality),
                      compressed.count < original.count else { return original }
                return compressed
            }
            if try encode(candidate).count <= budget { return candidate }
        }
        throw TooLarge()
    }
}
