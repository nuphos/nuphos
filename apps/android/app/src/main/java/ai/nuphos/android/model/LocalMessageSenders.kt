package ai.nuphos.android.model

/** Ephemeral proof of local authorship, never inferred from transcript history. */
internal class LocalMessageSenders {
    private var owner: String? = null
    private val sent = mutableMapOf<String, MessageAttribution>()

    fun bind(key: String?) {
        if (key != owner) { sent.clear(); owner = key }
    }
    fun record(id: String, key: String?, sender: MessageAttribution?) {
        if (key != null && key == owner && sender?.type == "user" && sender.source == "nuphos")
            sent.putIfAbsent(id, sender)
    }
    fun sender(id: String, key: String?): MessageAttribution? = if (key != null && key == owner) sent[id] else null
    fun clear() { sent.clear(); owner = null }
}
