import Foundation

/// The reconnect decisions `ChatSession.runTurn` makes, replayed step by step.
enum ResumeFallbackTests {
    static func run() {
        recoversAFirstSendThatNeverArrived()
        startsOverOnlyOnce()
        keepsARunThatAlreadyStreamed()
        leavesANativeStreamGoneAlone()
        print("Resume fallback passed")
    }

    static let conversationNotFound = #"{"error":{"code":"not_found","message":"Conversation not found"}}"#
    static let streamNotResumable = #"{"error":{"code":"stream_not_resumable","message":"gone"}}"#

    /// #979: the first send fails in transit, the reconnect resumes a run the
    /// server never stored and gets 404, and the turn is sent again fresh.
    private static func recoversAFirstSendThatNeverArrived() {
        var fallback = ResumeFallback()
        precondition(!ResumeFallback.resumes(explicit: false, reconnects: 0, framesReceived: 0), "the first send starts the turn")

        // The first POST never reached the backend: runTurn counts a reconnect.
        let resumed = ResumeFallback.resumes(explicit: false, reconnects: 1, framesReceived: 0)
        precondition(resumed, "a reconnect resumes the run")

        precondition(
            fallback.sendsFresh(status: 404, body: conversationNotFound, resumed: resumed, framesReceived: 0, explicit: false, nativeRuntime: true),
            "a reconnect that finds no conversation sends the turn again fresh"
        )
    }

    /// A fresh send that again finds no conversation surfaces the error.
    private static func startsOverOnlyOnce() {
        var fallback = ResumeFallback()
        precondition(fallback.sendsFresh(status: 404, body: conversationNotFound, resumed: true, framesReceived: 0, explicit: false, nativeRuntime: true))
        precondition(
            !fallback.sendsFresh(status: 404, body: conversationNotFound, resumed: true, framesReceived: 0, explicit: false, nativeRuntime: true),
            "the fresh start happens at most once per turn"
        )
    }

    /// A 404 after frames arrived, or on an explicit resume, is a real error.
    private static func keepsARunThatAlreadyStreamed() {
        var fallback = ResumeFallback()
        precondition(!fallback.sendsFresh(status: 404, body: conversationNotFound, resumed: true, framesReceived: 3, explicit: false, nativeRuntime: false))
        precondition(!fallback.sendsFresh(status: 404, body: conversationNotFound, resumed: true, framesReceived: 0, explicit: true, nativeRuntime: false))
        precondition(!fallback.sendsFresh(status: 404, body: conversationNotFound, resumed: false, framesReceived: 0, explicit: false, nativeRuntime: false))
        precondition(!fallback.sendsFresh(status: 404, body: #"{"error":{"code":"runtime_not_found"}}"#, resumed: true, framesReceived: 0, explicit: false, nativeRuntime: false))
    }

    /// A gone stream starts over on the Nuphos runtime only: a Claude Code /
    /// Codex runtime may already hold the message.
    private static func leavesANativeStreamGoneAlone() {
        var nuphos = ResumeFallback()
        precondition(nuphos.sendsFresh(status: 409, body: streamNotResumable, resumed: true, framesReceived: 0, explicit: false, nativeRuntime: false))
        var native = ResumeFallback()
        precondition(!native.sendsFresh(status: 409, body: streamNotResumable, resumed: true, framesReceived: 0, explicit: false, nativeRuntime: true))
    }
}
