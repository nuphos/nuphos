import Foundation

/// How a turn's reconnect picks between resuming the run and starting over.
///
/// A reconnect resumes the run the server already started. When the server
/// has nothing to resume, the turn is sent once more as a fresh start:
/// - `404 not_found`: the first send failed in transit, so the conversation
///   was never stored (#979). Nothing was recorded, so a resend cannot repeat
///   the message, even on a Claude Code / Codex runtime.
/// - `stream_not_resumable`: the stream is gone. A Claude Code / Codex runtime
///   keeps its own transcript and may already hold the message, so only the
///   Nuphos runtime starts over.
struct ResumeFallback {
    private(set) var used = false

    /// Whether the next POST resumes the run instead of starting the turn.
    static func resumes(explicit: Bool, reconnects: Int, framesReceived: Int) -> Bool {
        explicit || reconnects > 0 || framesReceived > 0
    }

    /// Whether a refused resume is sent again as a fresh start. Applies only to
    /// a resume our own reconnect sent before any frame arrived, at most once
    /// per turn.
    mutating func sendsFresh(
        status: Int,
        body: String?,
        resumed: Bool,
        framesReceived: Int,
        explicit: Bool,
        nativeRuntime: Bool
    ) -> Bool {
        guard !used, resumed, framesReceived == 0, !explicit else { return false }
        let code = Self.errorCode(body)
        let noConversation = status == 404 && code == "not_found"
        let streamGone = code == "stream_not_resumable" && !nativeRuntime
        guard noConversation || streamGone else { return false }
        used = true
        return true
    }

    private static func errorCode(_ body: String?) -> String? {
        guard let data = body?.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        let error = json["error"] as? [String: Any] ?? json
        return error["code"] as? String
    }
}
