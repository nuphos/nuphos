package ai.nuphos.android.data

import ai.nuphos.android.session.AiAccess
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

/** Keep account access independent and close all authenticated AI transports on revocation. */
class ConsentInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val bearer = request.header("Authorization")?.takeIf { it.startsWith("Bearer ") }
            ?.removePrefix("Bearer ") ?: return chain.proceed(request)
        if (request.url.scheme != "https" || request.url.host != "api.nuphos.ai")
            throw IOException("Nuphos credentials cannot be sent to this address.")
        if (request.url.encodedPath.startsWith("/auth/")) return chain.proceed(request)
        val revision = AiAccess.revision
        if (!AiAccess.allows(bearer)) throw IOException("Confirm your AI sharing choice before using agents.")
        val response = chain.proceed(request.newBuilder()
            .header("x-nuphos-ai-consent-version", AccountApi.AI_CONSENT_VERSION).build())
        if (response.code == 403 && response.peekBody(4096).string().contains("ai_consent_required")) {
            AiAccess.revokeIfCurrent(bearer, revision)
        }
        return response
    }
}
