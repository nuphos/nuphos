import Foundation
import UniformTypeIdentifiers

/// Uses the same authenticated transport and consent gate as chat.
enum WorkspaceAPI {
    static func request<T: Decodable>(_ path: String, token: String, method: String = "GET", body: JSONValue? = nil) async throws -> T {
        let data = try await AgentChatAPI.send(method, path, token: token, body: body, timeout: 60)
        return try JSONDecoder().decode(T.self, from: data)
    }

    struct TeamEnvelope: Decodable { let team: Team }
    struct TeamsEnvelope: Decodable { let teams: [Team] }
    struct Login: Decodable {
        let attemptId: String
        let state: String
        let authorizationUrl: String?
        let verificationUri: String?
        let userCode: String?
        let error: String?
        let codeSubmitted: Bool?
        /// One step of a sign-in that asks before it authorizes (OpenCode).
        var step: Step? = nil
        var pending: Bool { state == "starting" || state == "awaiting_authorization" }
        var url: URL? {
            guard let raw = step?.url ?? authorizationUrl ?? verificationUri, let url = URL(string: raw), url.scheme == "https" else { return nil }
            return url
        }
        /// Whether the sign-in waits for something the user types, picks or pastes.
        var needsAnswer: Bool {
            guard pending, codeSubmitted != true else { return false }
            if let step { return step.kind != "browser" || step.paste != nil }
            return authorizationUrl != nil
        }

        struct Step: Decodable, Equatable {
            struct Option: Decodable, Equatable, Identifiable {
                let value: String
                let label: String
                let hint: String?
                var id: String { value }
            }
            /// `choose`, `input` or `browser`.
            let kind: String
            let message: String?
            let options: [Option]?
            let placeholder: String?
            let secret: Bool?
            let url: String?
            let instructions: String?
            /// `code` or `address` when the page hands something back.
            let paste: String?
        }
    }

    /// Uploads photos and files straight to the transfer store, so the chat
    /// request only carries a reference however large the attachments are.
    static func upload(token: String, team: String, attachments: [ComposerAttachment], progress: Progress) async throws -> TransferUpload {
        struct Intent: Decodable {
            struct File: Decodable { let relPath: String; let uploadUrl: String }
            let groupId: String
            let files: [File]
        }
        struct Ready: Decodable { let status: String }
        let files = try attachments.enumerated().map { index, attachment -> (relPath: String, name: String, size: Int, type: String) in
            let size: Int
            let type: String
            switch attachment.kind {
            case .image(let data):
                size = data.count
                type = "image/jpeg"
            case .file(let url):
                size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            }
            guard size > 0, size <= 100 * 1024 * 1024 else {
                throw NuphosAPI.Failure.http(400, message: "Choose files between 1 byte and 100 MB.")
            }
            return ("\(index + 1)-" + attachment.uploadName.replacingOccurrences(of: "/", with: "_"), attachment.uploadName, size, type)
        }
        let path = "teams/\(team)/file-transfers"
        let intent: Intent = try await request(path, token: token, method: "POST", body: .object([
            "direction": .string("upload"),
            "files": .array(files.map { file in .object(["fileName": .string(file.name), "relPath": .string(file.relPath), "size": .number(Double(file.size)), "contentType": .string(file.type)]) })
        ]))
        guard intent.files.count == files.count else { throw NuphosAPI.Failure.invalidResponse }
        progress.totalUnitCount = Int64(files.reduce(0) { $0 + $1.size })
        for item in intent.files {
            guard let index = files.firstIndex(where: { $0.relPath == item.relPath }), let url = URL(string: item.uploadUrl), url.scheme == "https" else { throw NuphosAPI.Failure.invalidResponse }
            var request = URLRequest(url: url)
            request.httpMethod = "PUT"
            request.timeoutInterval = 180
            request.setValue(files[index].type, forHTTPHeaderField: "Content-Type")
            // Presigned storage requests never receive the Nuphos bearer token.
            let response: URLResponse
            let tracker = UploadProgress(parent: progress, units: Int64(files[index].size))
            switch attachments[index].kind {
            case .image(let data): (_, response) = try await URLSession.shared.upload(for: request, from: data, delegate: tracker)
            case .file(let file): (_, response) = try await URLSession.shared.upload(for: request, fromFile: file, delegate: tracker)
            }
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw NuphosAPI.Failure.http(502, message: "Couldn't upload \(files[index].name). Your message has not been sent; try again.")
            }
        }
        let ready: Ready = try await request(path + "/\(intent.groupId)/finalize", token: token, method: "POST")
        guard ready.status == "ready" else { throw NuphosAPI.Failure.http(409, message: "Files are not ready yet. Please retry.") }
        return TransferUpload(groupId: intent.groupId, files: files.map { .init(fileName: $0.name, size: $0.size) })
    }
}

/// Counts one upload's sent bytes into the message's overall progress.
private nonisolated final class UploadProgress: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    let progress: Progress

    init(parent: Progress, units: Int64) {
        progress = Progress(totalUnitCount: units, parent: parent, pendingUnitCount: units)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        progress.completedUnitCount = totalBytesSent
    }
}
