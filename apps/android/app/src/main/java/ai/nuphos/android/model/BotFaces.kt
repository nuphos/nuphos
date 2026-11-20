package ai.nuphos.android.model

import androidx.compose.runtime.mutableStateMapOf

/**
 * The faces of Bots this app has seen, learned from every list it loads, so a view that only knows
 * an agent's ID shows a Bot's face and a Task's runtime mark.
 */
object BotFaces {
    private val faces = mutableStateMapOf<String, String>()
    /** The tint each face sits on, learned with it; a Task has none. */
    private val backgrounds = mutableStateMapOf<String, String>()

    fun face(sessionId: String): String? = faces[sessionId]

    fun background(sessionId: String): String? = backgrounds[sessionId]

    fun learn(sessionId: String, avatar: String?, background: String? = null) {
        if (avatar == null) faces.remove(sessionId) else faces[sessionId] = avatar
        if (avatar == null || background == null) backgrounds.remove(sessionId) else backgrounds[sessionId] = background
    }

    fun learn(rows: List<AgentConversation>) {
        for (row in rows) {
            if (!row.isChannel) learn(row.sessionId, row.avatar, row.avatarBackground)
            row.faces.orEmpty().filter { it.agent != null }.forEach { learn(it.id, it.agent?.avatar, it.agent?.avatarBackground) }
        }
    }
}
