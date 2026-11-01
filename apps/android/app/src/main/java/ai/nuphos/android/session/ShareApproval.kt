package ai.nuphos.android.session

/**
 * Where a conversation on a teammate's computer shared at "Ask me first" stands
 * with that computer's owner: its messages wait in the queue until they approve.
 */
enum class ShareApprovalWait {
    Pending,
    Denied;

    fun message(computer: String): String = when (this) {
        Pending -> "Waiting for the owner of $computer to approve. Your message is sent once they do."
        Denied -> "The owner of $computer declined this conversation. Move it to another agent to continue."
    }

    companion object {
        /** `GET /agent/devices/share-approvals/mine`: nothing to show once approved, or never asked. */
        fun of(status: String?): ShareApprovalWait? = when (status) {
            "pending" -> Pending
            "denied" -> Denied
            else -> null
        }
    }
}
