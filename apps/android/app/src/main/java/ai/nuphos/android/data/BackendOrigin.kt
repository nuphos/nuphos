package ai.nuphos.android.data

import okhttp3.HttpUrl.Companion.toHttpUrl
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/** Backend selection and credential destinations are independent of UI lifetime. */
object BackendOrigin {
    const val DEFAULT = "https://api.nuphos.ai"
    @Volatile var current: String = ai.nuphos.android.BuildConfig.API_BASE_URL
        private set
    private val tokenOrigins = ConcurrentHashMap<String, String>()

    fun normalize(input: String): String {
        val value = input.trim()
        val uri = try { URI(value) } catch (_: Exception) { throw IllegalArgumentException("Enter a full HTTPS server address.") }
        require(uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrBlank() &&
            uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null &&
            uri.rawPath.orEmpty() in setOf("", "/") && uri.port in -1..65535 && uri.port != 0 &&
            '\\' !in value) { "Use an HTTPS address without a path, username, query or fragment." }
        return value.toHttpUrl().newBuilder().encodedPath("/").build().toString().removeSuffix("/")
    }

    internal fun select(origin: String) { current = normalize(origin) }

    private fun fingerprint(token: String): String = MessageDigest.getInstance("SHA-256")
        .digest(token.toByteArray()).joinToString("") { "%02x".format(it) }

    fun bind(token: String, origin: String = current) {
        require(token.isNotBlank())
        val key = fingerprint(token)
        val previous = tokenOrigins.putIfAbsent(key, origin)
        require(previous == null || previous == origin) { "This session belongs to another server." }
    }

    internal fun restore(token: String?, savedOrigin: String?): String? {
        val origin = savedOrigin ?: ai.nuphos.android.BuildConfig.API_BASE_URL
        if (origin != current) return null
        return token?.also { bind(it, origin) }
    }

    fun forToken(token: String): String = tokenOrigins[fingerprint(token)] ?: ai.nuphos.android.BuildConfig.API_BASE_URL
    fun isCloud(origin: String = current): Boolean = origin == DEFAULT

    internal fun supportsCloudPush(origin: String = current): Boolean = isCloud(origin) ||
        (ai.nuphos.android.BuildConfig.DEBUG && origin == ai.nuphos.android.BuildConfig.API_BASE_URL)

    fun accepts(token: String, address: String): Boolean = runCatching {
        val expected = forToken(token).toHttpUrl()
        val actual = address.toHttpUrl()
        actual.scheme == expected.scheme && actual.host == expected.host && actual.port == expected.port
    }.getOrDefault(false)
}
