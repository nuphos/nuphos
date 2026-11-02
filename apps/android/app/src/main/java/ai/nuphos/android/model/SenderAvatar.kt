package ai.nuphos.android.model

import ai.nuphos.android.BuildConfig
import java.net.URI

/** Transcript images never authorize arbitrary remote image requests. */
internal object SenderAvatar {
    private val google = setOf("lh3.googleusercontent.com", "lh4.googleusercontent.com", "lh5.googleusercontent.com", "lh6.googleusercontent.com")
    private val uploaded = Regex("/avatars/[0-9a-f]{24}/[0-9a-f]{64}\\.webp")

    fun trusted(raw: String?, apiBase: String = BuildConfig.API_BASE_URL): String? {
        if (raw.isNullOrEmpty() || raw.length > 2048) return null
        return try {
            val url = URI(raw)
            val base = URI(apiBase)
            if (url.scheme != "https" || url.rawUserInfo != null || url.host == null) return null
            val fromBackend = url.scheme == base.scheme && url.host == base.host && url.port == base.port &&
                url.rawQuery == null && url.rawFragment == null && uploaded.matches(url.rawPath.orEmpty())
            if (fromBackend || (url.host in google && url.port == -1)) raw else null
        } catch (_: Exception) { null }
    }
}
