import Foundation
import UniformTypeIdentifiers

/// Files an agent pushed to the user through the transfer store
/// (`upload_attachment`, the file-transfer skill). They are not transcript
/// parts: the store holds and expires them, so they are read next to the
/// transcript — the desktop's `useTransferDownloads`.
struct TransferDownloadGroup: Decodable, Equatable, Sendable {
    struct File: Decodable, Equatable, Identifiable, Sendable {
        let id: String
        let fileName: String
        let contentType: String?
        let status: String
        let downloadUrl: String?

        var isImage: Bool { kind(prefix: "image/", type: .image) }
        var isVideo: Bool { kind(prefix: "video/", type: .movie) }

        /// Agent pushes often carry no content type; the file name decides then.
        private func kind(prefix: String, type: UTType) -> Bool {
            if let contentType { return contentType.hasPrefix(prefix) }
            return UTType(filenameExtension: (fileName as NSString).pathExtension)?.conforms(to: type) == true
        }
    }

    let groupId: String
    let createdAt: Date
    let expiresAt: Date
    let files: [File]

    var readyFiles: [File] { files.filter { $0.status == "ready" } }

    private enum CodingKeys: String, CodingKey { case groupId, createdAt, expiresAt, files }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        groupId = try c.decode(String.self, forKey: .groupId)
        files = try c.decode([File].self, forKey: .files)
        func date(_ key: CodingKeys) throws -> Date {
            let raw = try c.decode(String.self, forKey: key)
            let parser = ISO8601DateFormatter()
            parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            guard let value = parser.date(from: raw) else {
                throw DecodingError.dataCorruptedError(forKey: key, in: c, debugDescription: "Invalid date \(raw)")
            }
            return value
        }
        createdAt = try date(.createdAt)
        expiresAt = try date(.expiresAt)
    }

    /// Which assistant message each group sits under: a group is pushed while
    /// a turn runs and the turn's reply is stamped when it ends, so it is the
    /// earliest reply stamped at or after the push — or the last reply, whose
    /// stamp the client may not hold yet.
    static func anchor(_ groups: [TransferDownloadGroup], in messages: [ChatMessage]) -> [String: [TransferDownloadGroup]] {
        let replies = messages.filter { $0.role == .assistant }
        guard let last = replies.last else { return [:] }
        var byMessage: [String: [TransferDownloadGroup]] = [:]
        for group in groups.sorted(by: { $0.createdAt < $1.createdAt }) {
            let anchor = replies.first { $0.createdAt.map { $0 >= group.createdAt } == true } ?? last
            byMessage[anchor.id, default: []].append(group)
        }
        return byMessage
    }
}
