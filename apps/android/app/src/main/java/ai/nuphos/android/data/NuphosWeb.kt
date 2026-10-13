package ai.nuphos.android.data

import android.net.Uri
import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest

/** Browser sign-in delivers a one-time code to a private loopback listener. */
object NuphosWeb {
    const val SITE_URL = "https://nuphos.ai"
    const val CALLBACK_SCHEME = "nuphos"
    const val CALLBACK_HOST = "google-callback"

    sealed class CallbackResult {
        data class Code(val code: String) : CallbackResult()
        data class Failure(val message: String) : CallbackResult()
    }

    fun loginUrl(handle: String): String {
        require(handle.matches(Regex("[A-Za-z0-9_-]{43}")))
        return "$SITE_URL/api/google/start?handle=$handle"
    }

    /** Old token intents can only return focus to the app; they carry no authority. */
    fun isReturnIntent(uri: Uri): Boolean =
        uri.scheme == CALLBACK_SCHEME && uri.host == CALLBACK_HOST

    fun parseDelivery(target: String, expectedState: String): CallbackResult? = runCatching {
        val uri = URI(target)
        if (uri.isAbsolute || uri.rawAuthority != null || uri.rawPath != "/callback" || uri.rawFragment != null)
            return null
        val params = mutableMapOf<String, String>()
        for (part in (uri.rawQuery ?: return null).split('&')) {
            val index = part.indexOf('=')
            if (index < 1) return null
            val key = URLDecoder.decode(part.substring(0, index), Charsets.UTF_8)
            val value = URLDecoder.decode(part.substring(index + 1), Charsets.UTF_8)
            if (params.put(key, value) != null) return null
        }
        if (params.keys.any { it !in setOf("state", "code", "error", "error_description") }) return null
        val state = params["state"] ?: return null
        if (!MessageDigest.isEqual(state.toByteArray(Charsets.UTF_8), expectedState.toByteArray(Charsets.UTF_8)))
            return null
        val code = params["code"]
        val error = params["error"]
        when {
            code != null && error == null && code.matches(Regex("[A-Za-z0-9_-]{43}")) -> CallbackResult.Code(code)
            error != null && code == null && error.isNotBlank() -> CallbackResult.Failure("Google did not complete this sign-in. Please try again.")
            else -> null
        }
    }.getOrNull()
}
