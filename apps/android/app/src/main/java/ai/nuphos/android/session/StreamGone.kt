package ai.nuphos.android.session

import ai.nuphos.android.model.ChatMessage

/**
 * What a turn does when the stream it resumed is gone (`stream_not_resumable`), as iOS does.
 * The stream is gone, not the turn: the run may have ended or moved on, and asking again would
 * make the agent answer twice.
 */
internal sealed interface StreamGone {
    /** A run is live on the server: follow it instead of asking again. */
    data class Follow(val streamId: String) : StreamGone
    /** The server already stored the reply this device missed. */
    data object Replied : StreamGone
    /** Nothing on the server answers the turn: send it once more. */
    data object Resend : StreamGone

    companion object {
        /** [sent] identifies the user message whose reply must not be repeated. */
        fun decide(stored: List<ChatMessage>, activeRun: String?, sent: String?): StreamGone {
            if (activeRun != null) return Follow(activeRun)
            val i = stored.indexOfFirst { it.id == sent }
            if (sent == null || i < 0) return Resend
            return if (stored.drop(i + 1).any { it.role == ChatMessage.Role.Assistant }) Replied else Resend
        }
    }
}
