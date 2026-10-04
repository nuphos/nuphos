import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Normalize picker formats and EXIF orientation without shrinking text or screenshots.
enum ImageAttachment {
    static func jpeg(from data: Data, quality: Double = 0.95) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: max(width, height),
              ] as CFDictionary) else { return nil }
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
    static let tooLargeMessage = "This message is too large to send. Remove some attachments or send them in separate messages. If it still fails, try a new chat."

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
