package ai.nuphos.android.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Step-up re-authentication. With two-factor authentication on, some actions
 * answer `403 reauth_required` (`method: mfa`) unless a code was entered in the
 * last few minutes. [StepUpInterceptor] sits on [Http.client], so every request
 * gets the same treatment: ask for a code ([StepUpDialogHost] shows it),
 * confirm it on `POST /auth/mfa/reauth`, then send the request once more.
 */
object StepUp {
    /** The account asking; set while the dialog is up. */
    var token: String? by mutableStateOf(null)
        private set

    /** Set while a host can show the dialog; without one, nothing asks. */
    @Volatile var hosted = false

    private val lock = Any()
    private var answer: CompletableDeferred<Boolean>? = null

    fun needsCode(body: String): Boolean = runCatching {
        val error = Http.json.parseToJsonElement(body).jsonObject["error"]?.jsonObject
        error?.get("code")?.jsonPrimitive?.contentOrNull == "reauth_required" &&
            error["details"]?.jsonObject?.get("method")?.jsonPrimitive?.contentOrNull == "mfa"
    }.getOrDefault(false)

    /** Blocks the calling network thread until the user answers; requests that ask together share one answer. */
    internal fun confirm(token: String): Boolean {
        if (!hosted) return false
        val pending = synchronized(lock) {
            answer ?: CompletableDeferred<Boolean>().also { answer = it; this.token = token }
        }
        return runBlocking { pending.await() }
    }

    /** Sends the code; throws when it is refused, which keeps the dialog up. */
    suspend fun submit(code: String) {
        val account = token ?: return
        AccountApi(account).reauthMfa(code)
        finish(true)
    }

    fun cancel() = finish(false)

    internal fun finish(ok: Boolean) {
        val pending = synchronized(lock) { answer.also { answer = null; token = null } }
        pending?.complete(ok)
    }
}

class StepUpInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val response = chain.proceed(request)
        if (response.code != 403 || request.url.encodedPath.endsWith("/auth/mfa/reauth")) return response
        val body = response.peekBody(64 * 1024).string()
        val token = request.header("Authorization")?.removePrefix("Bearer ")
        if (!StepUp.needsCode(body) || token.isNullOrBlank() || !StepUp.confirm(token)) return response
        response.close()
        return chain.proceed(request)
    }
}
