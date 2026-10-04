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
        var pending: Bool { state == "starting" || state == "awaiting_authorization" }
        var url: URL? {
            guard let raw = authorizationUrl ?? verificationUri, let url = URL(string: raw), url.scheme == "https" else { return nil }
            return url
        }
    }

    static func upload(token: String, team: String, attachments: [ComposerAttachment]) async throws -> String {
        struct Intent: Decodable {
            struct File: Decodable { let relPath: String; let uploadUrl: String }
            let groupId: String
            let files: [File]
        }
        struct Ready: Decodable { let status: String }
        let files = try attachments.enumerated().map { index, attachment -> (String, URL, Int, String) in
            guard case .file(let url) = attachment.kind else { throw NuphosAPI.Failure.invalidResponse }
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size > 0, size <= 100 * 1024 * 1024 else {
                throw NuphosAPI.Failure.http(400, message: "Choose files between 1 byte and 100 MB.")
            }
            let name = "\(index + 1)-" + attachment.name.replacingOccurrences(of: "/", with: "_")
            let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            return (name, url, size, type)
        }
        let path = "teams/\(team)/file-transfers"
        let intent: Intent = try await request(path, token: token, method: "POST", body: .object([
            "direction": .string("upload"),
            "files": .array(files.enumerated().map { index, file in .object(["fileName": .string(attachments[index].name), "relPath": .string(file.0), "size": .number(Double(file.2)), "contentType": .string(file.3)]) })
        ]))
        guard intent.files.count == files.count else { throw NuphosAPI.Failure.invalidResponse }
        for item in intent.files {
            guard let file = files.first(where: { $0.0 == item.relPath }), let url = URL(string: item.uploadUrl), url.scheme == "https" else { throw NuphosAPI.Failure.invalidResponse }
            var request = URLRequest(url: url)
            request.httpMethod = "PUT"
            request.timeoutInterval = 180
            request.setValue(file.3, forHTTPHeaderField: "Content-Type")
            // Presigned storage requests never receive the Nuphos bearer token.
            let (_, response) = try await URLSession.shared.upload(for: request, fromFile: file.1)
            if let http = response as? HTTPURLResponse, http.statusCode == 413 {
                throw ChatPayload.TooLarge()
            }
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw NuphosAPI.Failure.http(502, message: "Couldn't upload \(file.0). Your message has not been sent; try again.")
            }
        }
        let ready: Ready = try await request(path + "/\(intent.groupId)/finalize", token: token, method: "POST")
        guard ready.status == "ready" else { throw NuphosAPI.Failure.http(409, message: "Files are not ready yet. Please retry.") }
        return "[The user uploaded \(files.count) file(s) to the Nuphos file-transfer store (transfer group \(intent.groupId)): \(attachments.map { $0.name }.joined(separator: ", ")). To work with them, load the file-transfer skill and pull them into the sandbox: bash skills/file-transfer/scripts/transfer-pull.sh \"$TEAM\" \(intent.groupId) ./uploads]"
    }
}
