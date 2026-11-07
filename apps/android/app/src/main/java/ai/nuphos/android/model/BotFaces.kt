package ai.nuphos.android.model

import androidx.compose.runtime.mutableStateMapOf

/**
 * The faces of Bots this app has seen, learned from every list it loads, so a view that only knows
 * an agent's ID shows a Bot's face and a Task's runtime mark.
 */
object BotFaces {
    private val faces = mutableStateMapOf<String, String>()

    fun face(sessionId: String): String? = faces[sessionId]

    fun learn(sessionId: String, avatar: String?) {
        if (avatar == null) faces.remove(sessionId) else faces[sessionId] = avatar
    }

    fun learn(rows: List<AgentConversation>) {
        for (row in rows) {
            if (!row.isChannel) learn(row.sessionId, row.avatar)
            row.faces.orEmpty().filter { it.agent != null }.forEach { learn(it.id, it.agent?.avatar) }
        }
    }
}
