package ai.nuphos.android.data

import android.content.Context
import android.content.SharedPreferences
import ai.nuphos.android.session.ComposerDrafts
import kotlinx.serialization.json.*

/** App-private text, explicitly excluded from cloud backup and device-to-device transfer. */
class ComposerDraftPreferences internal constructor(private val prefs: SharedPreferences) : ComposerDrafts.Persistence {
    constructor(context: Context) : this(context.getSharedPreferences("nuphos.composer-drafts", Context.MODE_PRIVATE))
    private fun key(key: ComposerDrafts.Key): String = buildJsonArray {
        add(key.accountId); add(key.teamId)
        when (val destination = key.destination) {
            ComposerDrafts.Destination.NewChat -> { add("new"); add("") }
            is ComposerDrafts.Destination.Chat -> { add("chat"); add(destination.sessionId) }
        }
    }.toString()
    private fun decode(value: String): ComposerDrafts.Key? = runCatching {
        val parts = Http.json.parseToJsonElement(value).jsonArray.map { it.jsonPrimitive.content }
        require(parts.size == 4)
        val destination = when (parts[2]) {
            "new" -> ComposerDrafts.Destination.NewChat
            "chat" -> ComposerDrafts.Destination.Chat(parts[3])
            else -> return null
        }
        ComposerDrafts.Key(parts[0], parts[1], destination)
    }.getOrNull()
    override fun load(accountId: String): Map<ComposerDrafts.Key, String> = prefs.all.mapNotNull { (key, value) ->
        val address = decode(key)?.takeIf { it.accountId == accountId } ?: return@mapNotNull null
        (value as? String)?.let { address to it }
    }.toMap()
    override fun write(key: ComposerDrafts.Key, text: String) {
        prefs.edit().apply { if (text.isEmpty()) remove(key(key)) else putString(key(key), text) }.apply()
    }
    override fun clear() {
        // Also remove drafts whose identity was never restored (e.g. expired token).
        prefs.edit().clear().apply()
    }
}
