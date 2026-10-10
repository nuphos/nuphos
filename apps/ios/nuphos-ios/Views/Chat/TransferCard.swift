import QuickLook
import SwiftUI

/// The files in one transfer group: what the agent sent, or what the user
/// uploaded. One image shows whole; several shrink to a grid of square
/// thumbnails, and Quick Look swipes through all of them. Videos and other
/// files are chips. Every file opens in Quick Look (videos play there) from a
/// freshly signed link, with Save and Share.
struct TransferCard: View {
    let groupId: String
    let fromUser: Bool
    let session: ChatSession
    /// Shown as plain chips once the files can no longer be fetched (the
    /// transfer expired, or it belongs to someone else).
    var names: [String] = []

    @State private var files: [TransferDownloadGroup.File] = []
    @State private var opening: String?
    @State private var preview: URL?
    /// What Quick Look can swipe through: the group's images, or the one file.
    @State private var previewItems: [URL] = []
    @State private var failed = false
    @State private var unavailable = false

    var body: some View {
        VStack(alignment: fromUser ? .trailing : .leading, spacing: 8) {
            if images.count > 1 {
                let columns = Array(repeating: GridItem(.fixed(84), spacing: 6), count: min(images.count, 3))
                LazyVGrid(columns: columns, spacing: 6) {
                    ForEach(images) { file in openButton(file) }
                }
                .fixedSize()
            }
            ForEach(images.count > 1 ? others : files) { file in openButton(file) }
            if unavailable {
                ForEach(names, id: \.self) { name in chip(name, icon: "doc") }
            }
            if failed {
                HintRow(text: "Couldn't open the file. Try again.", isError: true)
            }
        }
        .task {
            guard let group = try? await session.transferGroup(groupId) else {
                unavailable = true
                return
            }
            files = group.readyFiles
        }
        .quickLookPreview($preview, in: previewItems)
    }

    private var images: [TransferDownloadGroup.File] { files.filter(\.isImage) }
    private var others: [TransferDownloadGroup.File] { files.filter { !$0.isImage } }

    private func openButton(_ file: TransferDownloadGroup.File) -> some View {
        Button { Task { await open(file) } } label: { label(file) }
            .buttonStyle(.plain)
            .disabled(opening != nil)
            .accessibilityLabel("Open \(file.fileName)")
    }

    @ViewBuilder
    private func label(_ file: TransferDownloadGroup.File) -> some View {
        if file.isImage, images.count > 1, let url = file.downloadUrl.flatMap(URL.init(string:)) {
            let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
            AsyncImage(url: url) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Theme.bubble
            }
            .frame(width: 84, height: 84)
            .clipShape(shape)
            .overlay(shape.strokeBorder(Theme.bubble))
            .overlay { if opening == file.id { ProgressView() } }
        } else if file.isImage, let url = file.downloadUrl.flatMap(URL.init(string:)) {
            let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
            AsyncImage(url: url) { image in
                image.resizable().scaledToFit()
                    .frame(maxWidth: 280, maxHeight: 280)
                    .clipShape(shape)
                    // Screenshots are mostly white; the outline keeps them off the page.
                    .overlay(shape.strokeBorder(Theme.bubble))
                    .overlay { if opening == file.id { ProgressView() } }
            } placeholder: {
                shape.fill(Theme.bubble).frame(width: 200, height: 140)
            }
        } else {
            chip(file.fileName, icon: file.isVideo ? "play.rectangle.fill" : file.isImage ? "photo" : "doc", busy: opening == file.id)
        }
    }

    private func chip(_ name: String, icon: String, busy: Bool = false) -> some View {
        HStack(spacing: 8) {
            if busy {
                ProgressView().controlSize(.small)
            } else {
                Image(systemName: icon)
            }
            Text(name).lineLimit(1).truncationMode(.middle)
        }
        .font(Theme.Text.label)
        .foregroundStyle(Theme.heading)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.bubble, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func open(_ file: TransferDownloadGroup.File) async {
        opening = file.id
        failed = false
        defer { opening = nil }
        do {
            // Presigned URLs expire; mint fresh ones for every open. Only the
            // tapped file must arrive; the group's other images come along when
            // they can, so Quick Look can swipe between them.
            let fresh = try await session.transferGroup(groupId)
            func remote(_ item: TransferDownloadGroup.File) -> URL? {
                fresh.files.first(where: { $0.id == item.id })?.downloadUrl.flatMap(URL.init(string:))
            }
            guard let url = remote(file) else { throw URLError(.fileDoesNotExist) }
            var locals = [file.id: try await Self.download(file, from: url)]
            if file.isImage {
                await withTaskGroup(of: (String, URL?).self) { group in
                    for item in images where item.id != file.id {
                        guard let url = remote(item) else { continue }
                        group.addTask { (item.id, try? await Self.download(item, from: url)) }
                    }
                    for await (id, local) in group { locals[id] = local }
                }
            }
            previewItems = (file.isImage ? images : [file]).compactMap { locals[$0.id] }
            preview = locals[file.id]
        } catch {
            failed = true
        }
    }

    /// One local copy per file: a file already downloaded is reused, not fetched again.
    private static func download(_ file: TransferDownloadGroup.File, from remote: URL) async throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appending(path: "downloads/\(file.id)")
        let local = dir.appending(path: file.fileName.replacingOccurrences(of: "/", with: "_"))
        if FileManager.default.fileExists(atPath: local.path) { return local }
        let (temp, response) = try await URLSession.shared.download(from: remote)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try FileManager.default.moveItem(at: temp, to: local)
        return local
    }
}
