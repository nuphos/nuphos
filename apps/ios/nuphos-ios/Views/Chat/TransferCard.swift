import AVFoundation
import QuickLook
import SwiftUI

/// The files in one transfer group: what the agent sent, or what the user
/// uploaded. Images and videos are one grid of fixed squares, so nothing
/// grows once it loads; a video shows its first frame under a play glyph.
/// A lone image shows whole, fitted within a 260pt square, so a portrait
/// screenshot is not cropped and a wide one is not boxed in empty space.
/// Images and videos open in the pager, which swipes through all of them in
/// grid order. Other files (chips) open in Quick Look from a freshly signed
/// link, with Save and Share.
struct TransferCard: View {
    /// One message's groups, drawn as one grid so its images sit in one row.
    let groupIds: [String]
    let fromUser: Bool
    /// A group's files with fresh links: a conversation's or a chat's.
    let resolve: (String) async throws -> TransferDownloadGroup
    /// Shown as plain chips once the files can no longer be fetched (the
    /// transfer expired, or it belongs to someone else).
    var names: [String] = []

    init(groupId: String, fromUser: Bool, session: ChatSession, names: [String] = []) {
        self.init(groupIds: [groupId], fromUser: fromUser, names: names) { try await session.transferGroup($0) }
    }

    /// `files`, when already read, are drawn from the first frame, so the card
    /// never grows under the reader; nil reads them when it appears.
    init(groupIds: [String], fromUser: Bool, names: [String] = [], files: [TransferDownloadGroup.File]? = nil,
         resolve: @escaping (String) async throws -> TransferDownloadGroup) {
        self.groupIds = groupIds
        self.fromUser = fromUser
        self.names = names
        self.resolve = resolve
        preloaded = files != nil
        _files = State(initialValue: files ?? [])
        _unavailable = State(initialValue: files?.isEmpty == true)
    }

    private let preloaded: Bool

    @State private var files: [TransferDownloadGroup.File] = []
    @State private var opening: String?
    @State private var preview: URL?
    /// What the preview can swipe through: the message's media, or the one file.
    @State private var previewItems: [URL] = []
    /// The image or video the full-screen pager opens on.
    @State private var pagerStart: URL?
    @State private var failed = false
    @State private var unavailable = false

    var body: some View {
        VStack(alignment: fromUser ? .trailing : .leading, spacing: 8) {
            if media.count == 1, let lone = media.first, lone.isImage {
                openButton(lone, lone: true)
            } else if !media.isEmpty {
                let columns = Array(repeating: GridItem(.fixed(84), spacing: 6), count: min(media.count, 3))
                LazyVGrid(columns: columns, spacing: 6) {
                    ForEach(media) { file in openButton(file) }
                }
                .fixedSize()
            }
            ForEach(others) { file in openButton(file) }
            if unavailable {
                ForEach(names, id: \.self) { name in chip(name, icon: "doc") }
            }
            if failed {
                HintRow(text: "Couldn't open the file. Try again.", isError: true)
            }
        }
        .task {
            guard !preloaded else { return }
            guard let groups = try? await fetch() else {
                unavailable = true
                return
            }
            files = groups.flatMap(\.readyFiles)
        }
        .quickLookPreview($preview, in: previewItems)
        #if os(iOS)
        .fullScreenCover(isPresented: Binding(get: { pagerStart != nil }, set: { if !$0 { pagerStart = nil } })) {
            if let pagerStart {
                MediaPager(urls: previewItems, current: pagerStart) { url in
                    guard let video = media.first(where: { TransferFiles.path($0) == url }) else { return }
                    _ = try await TransferFiles.localCopies(of: [video], tapped: video) { try await fetch().flatMap(\.files) }
                }
            }
        }
        #endif
    }

    private var media: [TransferDownloadGroup.File] { files.filter { $0.isImage || $0.isVideo } }
    private var others: [TransferDownloadGroup.File] { files.filter { !$0.isImage && !$0.isVideo } }

    /// The lone image's widest and tallest.
    private static let loneSide: CGFloat = 260

    private func openButton(_ file: TransferDownloadGroup.File, lone: Bool = false) -> some View {
        Button { Task { await open(file) } } label: { label(file, lone: lone) }
            .buttonStyle(.plain)
            .disabled(opening != nil)
            .accessibilityLabel("Open \(file.fileName)")
    }

    @ViewBuilder
    private func label(_ file: TransferDownloadGroup.File, lone: Bool = false) -> some View {
        if lone, let url = file.downloadUrl.flatMap(URL.init(string:)) {
            let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
            FitWithin(side: Self.loneSide) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFit()
                        .clipShape(shape)
                        .overlay(shape.strokeBorder(Theme.bubble))
                        .overlay { if opening == file.id { ProgressView() } }
                } placeholder: {
                    shape.fill(Theme.bubble).frame(width: Self.loneSide * 0.75)
                }
            }
        } else if file.isImage || file.isVideo, let url = file.downloadUrl.flatMap(URL.init(string:)) {
            let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
            Group {
                if file.isVideo {
                    VideoFrame(url: url)
                } else {
                    AsyncImage(url: url) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Theme.bubble
                    }
                }
            }
            .frame(width: 84, height: 84)
            .clipShape(shape)
            // A wide image fills past its square; clipping hides the rest but
            // still takes taps there, which would open it instead of its neighbour.
            .contentShape(shape)
            // Screenshots are mostly white; the outline keeps them off the page.
            .overlay(shape.strokeBorder(Theme.bubble))
            .overlay {
                if opening == file.id {
                    ProgressView()
                } else if file.isVideo {
                    Image(systemName: "play.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(.white)
                        .frame(width: 28, height: 28)
                        .background(.black.opacity(0.6), in: Circle())
                }
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
            // A file already on disk opens at once; only missing ones are
            // re-signed (presigned links expire) and fetched. The message's
            // other images come along so the pager can swipe between them;
            // its other videos are fetched once their page shows.
            let shown = media.contains(file) ? media : [file]
            let locals = try await TransferFiles.localCopies(of: shown.filter { !$0.isVideo || $0 == file }, tapped: file) {
                try await fetch().flatMap(\.files)
            }
            previewItems = shown.compactMap { $0.isVideo ? TransferFiles.path($0) : locals[$0.id] }
            #if os(iOS)
            // Anything the pager can't show (an SVG, say) stays with Quick Look.
            let pageable = previewItems.filter(MediaPager.shows)
            if let start = locals[file.id], pageable.contains(start) {
                previewItems = pageable
                pagerStart = start
                return
            }
            #endif
            previewItems = previewItems.filter { FileManager.default.fileExists(atPath: $0.path) }
            preview = locals[file.id]
        } catch {
            failed = true
        }
    }

    /// Every group; one that is gone drops out, and only all of them gone fails.
    private func fetch() async throws -> [TransferDownloadGroup] {
        var groups: [TransferDownloadGroup] = []
        var failure: Error?
        for id in groupIds {
            do { groups.append(try await resolve(id)) } catch { failure = error }
        }
        if groups.isEmpty, let failure { throw failure }
        return groups
    }
}

/// Offers its content a square of `side` and takes the size the content
/// picks, so a lone image is as wide and as tall as it fits: no empty band
/// above and below a wide one, as a fixed-height frame would leave.
private struct FitWithin: Layout {
    let side: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        subviews.first?.sizeThatFits(ProposedViewSize(width: min(proposal.width ?? side, side), height: side)) ?? .zero
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(bounds.size))
    }
}

/// A video's first frame, read from the stream without downloading the file.
/// Black until it decodes, or if it can't.
private struct VideoFrame: View {
    let url: URL
    @State private var frame: CGImage?

    var body: some View {
        ZStack {
            Color.black
            if let frame { Image(decorative: frame, scale: 1).resizable().scaledToFill() }
        }
        .task {
            let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: 252, height: 252)
            frame = try? await generator.image(at: .zero).image
        }
    }
}
