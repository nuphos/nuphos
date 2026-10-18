import Foundation
import UniformTypeIdentifiers

/// A pasted item's file, copied into our temp dir: the provider's file is
/// only readable inside its callback. Named after what the copier called it.
struct PastedFile: Sendable {
    let url: URL
    let type: UTType
    let name: String

    /// Tries each advertised type in order: an earlier one may fail to load
    /// where a later one works.
    static func load(_ provider: NSItemProvider) async -> PastedFile? {
        for type in provider.registeredContentTypes {
            let file: PastedFile? = await withCheckedContinuation { continuation in
                _ = provider.loadFileRepresentation(for: type, openInPlace: false) { url, _, _ in
                    continuation.resume(returning: url.flatMap { copy($0, type: type, name: provider.suggestedName) })
                }
            }
            if let file { return file }
        }
        return nil
    }

    private static func copy(_ source: URL, type: UTType, name: String?) -> PastedFile? {
        let ext = source.pathExtension.isEmpty ? type.preferredFilenameExtension ?? "" : source.pathExtension
        // Unnamed (a copied image, say), the source is a temp file named by a hash.
        var name = name ?? "Pasted"
        if (name as NSString).pathExtension.isEmpty, !ext.isEmpty { name += "." + ext }
        let dest = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
        guard (try? FileManager.default.copyItem(at: source, to: dest)) != nil else { return nil }
        return PastedFile(url: dest, type: type, name: name)
    }
}
