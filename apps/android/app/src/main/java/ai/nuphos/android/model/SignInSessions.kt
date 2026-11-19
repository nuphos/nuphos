package ai.nuphos.android.model

import ai.nuphos.android.R
import ai.nuphos.android.data.Instants
import java.time.Instant

/** How a sign-in session is labelled. Matches Desktop's signInSessionsPresentation.ts. */
object SignInSessions {
    private val apps = mapOf(
        "nuphos-desktop" to "Nuphos Desktop",
        "nuphos-ios" to "Nuphos for iOS",
        "nuphos-android" to "Nuphos for Android",
        "nuphos-cli" to "Nuphos CLI",
    )
    private val webSignIn = Regex("^(node|undici)\\b", RegexOption.IGNORE_CASE)
    private val browsers = listOf(
        Regex("Edg/") to "Edge",
        Regex("Firefox/") to "Firefox",
        Regex("Chrome/") to "Chrome",
        Regex("Safari/") to "Safari",
    )
    private val systems = listOf(
        Regex("iPhone|iPad") to "iOS",
        Regex("Android") to "Android",
        Regex("Macintosh|Mac OS X") to "macOS",
        Regex("Windows") to "Windows",
        Regex("Linux") to "Linux",
    )

    /**
     * What signed in. The app name and user agent are whatever the signing-in
     * client sent, so none of their text is shown, not even an app's version: a
     * known app, a browser and system from a fixed list, or "Unknown device" (as
     * the backend's emails do).
     */
    fun device(session: SignInSession): String {
        apps[session.client.orEmpty().substringBefore('/')]?.let { return it }
        val ua = session.userAgent.orEmpty()
        // The nuphos.ai web sign-in reaches the backend from the website's server.
        if (session.client.isNullOrEmpty() && webSignIn.containsMatchIn(ua)) return Words(R.string.storetext_signin_web)
        val browser = browsers.firstOrNull { it.first.containsMatchIn(ua) }?.second
        val system = systems.firstOrNull { it.first.containsMatchIn(ua) }?.second
        return when {
            browser != null && system != null -> Words(R.string.storetext_signin_browser_on_system, browser, system)
            browser != null -> browser
            system != null -> Words(R.string.storetext_signin_browser_on, system)
            else -> Words(R.string.storetext_signin_unknown_device)
        }
    }

    fun place(session: SignInSession): String {
        val place = listOfNotNull(session.city, session.country).filter { it.isNotEmpty() }.joinToString(", ")
        return listOfNotNull(place.ifEmpty { Words(R.string.storetext_signin_unknown_location) }, session.ip?.ifEmpty { null }).joinToString(" · ")
    }

    fun activity(session: SignInSession, now: Instant = Instant.now()): String? {
        if (session.current == true) return Words(R.string.storetext_signin_active_now)
        val at = Instants.parse(session.lastUsedAt) ?: return null
        // HistoryTime.format reads "now" under a minute; decide on the time, not its text.
        return if (now.epochSecond - at.epochSecond < 60) Words(R.string.storetext_signin_last_active_just_now)
        else Words(R.string.storetext_signin_last_active, HistoryTime.format(at, now))
    }

    /** This device first, then the most recently active. */
    fun sorted(sessions: List<SignInSession>): List<SignInSession> = sessions.sortedWith(
        compareByDescending<SignInSession> { it.current == true }
            .thenByDescending { Instants.parse(it.lastUsedAt) ?: Instant.MIN },
    )
}
