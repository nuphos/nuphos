import QuickLook
import SwiftUI

/// Files the agent sent the user. Images show inline; every file opens in
/// Quick Look, which also offers Save and Share.
struct DownloadCard: View {
    let group: TransferDownloadGroup
    let session: ChatSession

    @State private var imageURLs: [String: URL] = [:]
    @State private var opening: String?
    @State private var preview: URL?
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(group.readyFiles) { file in
                Button { Task { await open(file) } } label: { label(file) }
                    .buttonStyle(.plain)
                    .disabled(opening != nil)
                    .accessibilityLabel("Open \(file.fileName)")
            }
            if failed {
                HintRow(text: "Couldn't open the file. Try again.", isError: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task {
            guard group.readyFiles.contains(where: \.isImage) else { return }
            imageURLs = (try? await session.downloadURLs(for: group)) ?? [:]
        }
        .quickLookPreview($preview)
    }

    @ViewBuilder
    private func label(_ file: TransferDownloadGroup.File) -> some View {
        if file.isImage, let url = imageURLs[file.id] {
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
            HStack(spacing: 8) {
                if opening == file.id {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: file.isImage ? "photo" : "doc")
                }
                Text(file.fileName).lineLimit(1).truncationMode(.middle)
            }
            .font(Theme.Text.label)
            .foregroundStyle(Theme.heading)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Theme.bubble, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    private func open(_ file: TransferDownloadGroup.File) async {
        opening = file.id
        failed = false
        defer { opening = nil }
        do {
            // Presigned URLs expire; mint a fresh one for every open.
            guard let remote = try await session.downloadURLs(for: group)[file.id] else { throw URLError(.fileDoesNotExist) }
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
