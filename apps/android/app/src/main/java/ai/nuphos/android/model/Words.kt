package ai.nuphos.android.model

import ai.nuphos.android.R
import android.content.Context
import androidx.annotation.PluralsRes
import androidx.annotation.StringRes
import java.io.File

/** Text that code outside Compose shows to people, in the app's current language. */
object Words {
    /** Set by the Application; JVM tests have none and read the English strings files instead. */
    @Volatile var context: Context? = null

    operator fun invoke(@StringRes id: Int, vararg args: Any): String =
        context?.getString(id, *args) ?: english(R.string::class.java, id, 1).format(*args)

    fun plural(@PluralsRes id: Int, count: Int, vararg args: Any): String =
        context?.resources?.getQuantityString(id, count, *args) ?: english(R.plurals::class.java, id, count).format(*args)

    private fun english(type: Class<*>, id: Int, count: Int): String {
        val name = type.fields.first { it.getInt(null) == id }.name
        return englishStrings.getValue(if (type == R.plurals::class.java) "$name/${if (count == 1) "one" else "other"}" else name)
    }

    private val englishStrings: Map<String, String> by lazy {
        val directory = File(checkNotNull(System.getProperty("nuphos.strings")) { "Words.context is not set" })
        val entry = Regex("""<string name="(\w+)"[^>]*>(.*?)</string>|<plurals name="(\w+)">(.*?)</plurals>""", RegexOption.DOT_MATCHES_ALL)
        val item = Regex("""<item quantity="(\w+)">(.*?)</item>""")
        directory.listFiles { file -> file.name.startsWith("strings") }!!.flatMap { file ->
            entry.findAll(file.readText()).flatMap { m ->
                if (m.groupValues[1].isNotEmpty()) sequenceOf(m.groupValues[1] to m.groupValues[2])
                else item.findAll(m.groupValues[4]).map { "${m.groupValues[3]}/${it.groupValues[1]}" to it.groupValues[2] }
            }.toList()
        }.associate { (key, raw) -> key to unescape(raw) }
    }

    private fun unescape(raw: String) = raw.removeSurrounding("\"").replace("\\'", "'").replace("\\\"", "\"")
        .replace("\\n", "\n").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
}
