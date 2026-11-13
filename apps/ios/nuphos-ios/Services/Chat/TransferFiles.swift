import Foundation

/// One local copy per transfer file, keyed by the file's stable id, never by
/// its link: the store signs a new link on every read, so a link-keyed cache
/// would miss each time.
enum TransferFiles {
    static let defaultRoot = FileManager.default.temporaryDirectory.appending(path: "downloads")

    /// Local copies of `wanted`. Files already on disk open from there without
    /// reading `links`; only missing ones need freshly signed links. `tapped`
    /// must arrive; the rest come along when they can.
    static func localCopies(
        of wanted: [TransferDownloadGroup.File], tapped: TransferDownloadGroup.File,
        links: () async throws -> [TransferDownloadGroup.File],
        root: URL = defaultRoot, session: URLSession = .shared
    ) async throws -> [String: URL] {
        var locals: [String: URL] = [:]
        for item in wanted where FileManager.default.fileExists(atPath: path(item, root).path) {
            locals[item.id] = path(item, root)
        }
        guard locals.count < wanted.count else { return locals }
        // An uncached tap reports why the links could not be read (offline, say).
        let fresh = locals[tapped.id] == nil ? try await links() : (try? await links()) ?? []
        func remote(_ item: TransferDownloadGroup.File) -> URL? {
            fresh.first(where: { $0.id == item.id })?.downloadUrl.flatMap(URL.init(string:))
        }
        if locals[tapped.id] == nil {
            guard let url = remote(tapped) else { throw URLError(.fileDoesNotExist) }
            locals[tapped.id] = try await download(tapped, from: url, root: root, session: session)
        }
        await withTaskGroup(of: (String, URL?).self) { group in
            for item in wanted where locals[item.id] == nil {
                guard let url = remote(item) else { continue }
                group.addTask { (item.id, try? await download(item, from: url, root: root, session: session)) }
            }
            for await (id, local) in group { locals[id] = local }
        }
        trim(root, keeping: Set(locals.keys))
        return locals
    }

    /// Drops every copy, so files do not outlive the account that could read them.
    static func clear(_ root: URL = defaultRoot) {
        try? FileManager.default.removeItem(at: root)
    }

    /// Where `file`'s copy lives, whether or not it has been fetched yet.
    static func path(_ file: TransferDownloadGroup.File, _ root: URL = defaultRoot) -> URL {
        root.appending(path: file.id).appending(path: file.fileName.replacingOccurrences(of: "/", with: "_"))
    }

    private static func download(_ file: TransferDownloadGroup.File, from remote: URL, root: URL, session: URLSession) async throws -> URL {
        let local = path(file, root)
        let (temp, response) = try await session.download(from: remote)
        // Only a preview fixture's file link answers without an HTTP status.
        guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? remote.isFileURL else {
            throw URLError(.badServerResponse)
        }
        try FileManager.default.createDirectory(at: local.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: local)
        try FileManager.default.moveItem(at: temp, to: local)
        return local
    }

    /// Keeps the copies under `limit` bytes, dropping the oldest first, but
    /// never the ones about to be shown.
    static func trim(_ root: URL, keeping ids: Set<String>, limit: Int = 256 << 20) {
        let keys: [URLResourceKey] = [.isRegularFileKey, .totalFileAllocatedSizeKey, .contentModificationDateKey]
        let all = FileManager.default.enumerator(at: root, includingPropertiesForKeys: keys)?.allObjects as? [URL] ?? []
        let files = all.compactMap { url -> (URL, Int, Date)? in
            guard let v = try? url.resourceValues(forKeys: Set(keys)), v.isRegularFile == true else { return nil }
            return (url, v.totalFileAllocatedSize ?? 0, v.contentModificationDate ?? .distantPast)
        }.sorted { $0.2 > $1.2 }
        var total = 0
        for (url, size, _) in files {
            total += size
            let dir = url.deletingLastPathComponent()
            if total > limit, !ids.contains(dir.lastPathComponent) { try? FileManager.default.removeItem(at: dir) }
        }
    }
}
