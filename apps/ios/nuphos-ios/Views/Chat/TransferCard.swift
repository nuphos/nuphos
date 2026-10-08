import QuickLook
import SwiftUI

/// The files in one transfer group: what the agent sent, or what the user
/// uploaded. Images show inline; videos and other files are chips. Every file
/// opens in Quick Look (videos play there) from a freshly signed link, with
/// Save and Share.
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
    @State private var failed = false
    @State private var unavailable = false

    var body: some View {
        VStack(alignment: fromUser ? .trailing : .leading, spacing: 8) {
            ForEach(files) { file in
                Button { Task { await open(file) } } label: { label(file) }
                    .buttonStyle(.plain)
                    .disabled(opening != nil)
                    .accessibilityLabel("Open \(file.fileName)")
            }
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
        .quickLookPreview($preview)
    }

    @ViewBuilder
    private func label(_ file: TransferDownloadGroup.File) -> some View {
        if file.isImage, let url = file.downloadUrl.flatMap(URL.init(string:)) {
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
            // Presigned URLs expire; mint a fresh one for every open.
            let fresh = try await session.transferGroup(groupId)
            guard let remote = fresh.files.first(where: { $0.id == file.id })?.downloadUrl.flatMap(URL.init(string:)) else {
                throw URLError(.fileDoesNotExist)
            }
            let (temp, response) = try await URLSession.shared.download(from: remote)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
            let dir = FileManager.default.temporaryDirectory.appending(path: "downloads/\(file.id)")
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let local = dir.appending(path: file.fileName.replacingOccurrences(of: "/", with: "_"))
            try? FileManager.default.removeItem(at: local)
            try FileManager.default.moveItem(at: temp, to: local)
            preview = local
        } catch {
            failed = true
        }
    }
}
