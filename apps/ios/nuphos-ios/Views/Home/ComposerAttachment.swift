import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Something the user attached in the composer: a photo (kept as JPEG
/// data, sent as a data URL) or a file picked from Files.
struct ComposerAttachment: Identifiable, Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case image(Data)
        case file(URL)
    }

    let id = UUID()
    let name: String
    var kind: Kind

    #if canImport(UIKit)
    var thumbnail: UIImage? {
        if case .image(let data) = kind { return UIImage(data: data) }
        return nil
    }
    #endif

    var isImage: Bool { if case .image = kind { return true }; return false }

    /// `data:image/jpeg;base64,…` for the transcript's `file` part.
    var dataURL: String? {
        guard case .image(let data) = kind else { return nil }
        return "data:image/jpeg;base64," + data.base64EncodedString()
    }

    var fileExtension: String {
        if case .file(let url) = kind { return url.pathExtension.uppercased() }
        return "JPG"
    }

    // MARK: Loading

    /// Loads a full-resolution, high-quality JPEG. Compression is decided
    /// later from the whole message budget, not an arbitrary per-photo cap.
    static func load(_ item: PhotosPickerItem) async -> ComposerAttachment? {
        guard let data = try? await item.loadTransferable(type: Data.self) else { return nil }
        guard let jpeg = ImageAttachment.jpeg(from: data) else { return nil }
        return ComposerAttachment(name: "Photo", kind: .image(jpeg))
    }

    /// Copies a Files-picked URL into our temp dir (the picker's URL is only
    /// readable while security-scoped).
    static func load(fileURL: URL) -> ComposerAttachment? {
        let scoped = fileURL.startAccessingSecurityScopedResource()
        defer { if scoped { fileURL.stopAccessingSecurityScopedResource() } }
        let dest = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(fileURL.pathExtension)
        do {
            try FileManager.default.copyItem(at: fileURL, to: dest)
        } catch {
            return nil
        }
        if let type = UTType(filenameExtension: fileURL.pathExtension), type.conforms(to: .image),
           let data = try? Data(contentsOf: dest) {
            if let jpeg = ImageAttachment.jpeg(from: data) {
                return ComposerAttachment(name: fileURL.lastPathComponent, kind: .image(jpeg))
            }
        }
        return ComposerAttachment(name: fileURL.lastPathComponent, kind: .file(dest))
    }
}

/// What the composer hands back on send.
struct ComposerSubmission: Sendable {
    var text: String
    var attachments: [ComposerAttachment]
}

/// A 64pt square preview with a remove button in its corner.
struct AttachmentTile: View {
    let attachment: ComposerAttachment
    var onRemove: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                #if canImport(UIKit)
                if let image = attachment.thumbnail {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    filePlaceholder
                }
                #else
                filePlaceholder
                #endif
            }
            .frame(width: 64, height: 64)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))

            Button(action: onRemove) {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Theme.canvas)
                    .frame(width: 18, height: 18)
                    .background(Theme.heading, in: Circle())
            }
            .buttonStyle(.plain)
            .offset(x: 5, y: -5)
            .accessibilityLabel("Remove \(attachment.name)")
        }
        .padding(.top, 5)
        .padding(.trailing, 5)
    }

    private var filePlaceholder: some View {
        VStack(spacing: 4) {
            Image(systemName: "doc").font(.system(size: 18, weight: .medium)).foregroundStyle(Theme.body)
            Text(attachment.fileExtension.isEmpty ? "FILE" : attachment.fileExtension)
                .font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bubble)
    }
}
