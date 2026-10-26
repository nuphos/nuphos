package ai.nuphos.android.model

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
    private val appClient = Regex("(nuphos-(?:desktop|ios|android|cli))/([0-9][\\w.+-]{0,31})")
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
     * client sent, so their text is never shown: a known app, a browser and system
     * from a fixed list, or "Unknown device" (as the backend's emails do).
     */
    fun device(session: SignInSession): String {
        appClient.matchEntire(session.client.orEmpty())?.let { return "${apps.getValue(it.groupValues[1])} ${it.groupValues[2]}" }
        val ua = session.userAgent.orEmpty()
        // The nuphos.ai web sign-in reaches the backend from the website's server.
        if (session.client.isNullOrEmpty() && webSignIn.containsMatchIn(ua)) return "Web sign-in (nuphos.ai)"
        val browser = browsers.firstOrNull { it.first.containsMatchIn(ua) }?.second
        val system = systems.firstOrNull { it.first.containsMatchIn(ua) }?.second
        return when {
            browser != null && system != null -> "$browser on $system"
            browser != null -> browser
            system != null -> "A browser on $system"
            else -> "Unknown device"
        }
    }

    fun place(session: SignInSession): String {
        val place = listOfNotNull(session.city, session.country).filter { it.isNotEmpty() }.joinToString(", ")
        return listOfNotNull(place.ifEmpty { "Unknown location" }, session.ip?.ifEmpty { null }).joinToString(" · ")
    }

    fun activity(session: SignInSession, now: Instant = Instant.now()): String? {
        if (session.current == true) return "Active now"
        val at = Instants.parse(session.lastUsedAt) ?: return null
        val age = HistoryTime.format(at, now)
        return if (age == "now") "Last active just now" else "Last active $age ago"
    }

    /** This device first, then the most recently active. */
    fun sorted(sessions: List<SignInSession>): List<SignInSession> = sessions.sortedWith(
        compareByDescending<SignInSession> { it.current == true }
            .thenByDescending { Instants.parse(it.lastUsedAt) ?: Instant.MIN },
    )
}
