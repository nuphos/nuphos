package ai.nuphos.android.notifications

import android.app.Activity
import android.app.Application
import android.os.Bundle
import ai.nuphos.android.NuphosApplication
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.NuphosApi
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.security.MessageDigest
import java.util.UUID

/** Binding survives process death, but is usable only with the same saved login credential. */
class PushNotifications(private val app: NuphosApplication) : Application.ActivityLifecycleCallbacks {
    private val prefs = app.getSharedPreferences("push_binding", Application.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mutex = Mutex()
    private val bindingLock = Any()
    @Volatile private var login: Pair<String, String>? = null
    @Volatile private var registration: Pair<String, String>? = null
    @Volatile private var started = 0
    private fun fingerprint(token: String) = MessageDigest.getInstance("SHA-256")
        .digest(token.toByteArray()).joinToString("") { "%02x".format(it) }

    fun reset(clearPending: Boolean = true) {
        val oldLogin = login
        val oldRegistration = registration
        synchronized(bindingLock) {
            login = null
            registration = null
            prefs.edit().remove("account").remove("login_hash").remove("consent_granted").commit()
        }
        app.localNotifications.clear(clearPending)
        if (FirebaseApp.getApps(app).isNotEmpty()) FirebaseMessaging.getInstance().isAutoInitEnabled = false
        if (oldLogin != null && oldRegistration != null) scope.launch {
            mutex.withLock {
                if (registration != oldRegistration) runCatching { unregister(oldLogin.second, oldRegistration.second) }
            }
        }
    }

    fun sync(account: String?, token: String?, allowed: Boolean) {
        if (account == null || token == null || !allowed) { reset(clearPending = account == null); return }
        val next = account to token
        if (login == next) return
        reset(clearPending = app.localNotifications.pending.value.value?.accountId != account)
        synchronized(bindingLock) {
            if (!ai.nuphos.android.session.AiAccess.allows(token)) return
            login = next
        }
        if (FirebaseApp.getApps(app).isEmpty()) return
        FirebaseMessaging.getInstance().isAutoInitEnabled = true
        requestToken()
    }

    private fun requestToken() {
        if (FirebaseApp.getApps(app).isNotEmpty() && login != null)
            FirebaseMessaging.getInstance().token.addOnSuccessListener { refreshed(it) }
    }

    fun refreshed(fcmToken: String) {
        val expected = login ?: return
        if (FirebaseApp.getApps(app).isEmpty()) return
        if (registration == (expected.first to fcmToken)) return
        val project = FirebaseApp.getInstance().options.projectId ?: return
        scope.launch {
            mutex.withLock {
                repeat(3) { attempt ->
                    if (login != expected) return@withLock
                    val ok = runCatching {
                        val device = prefs.getString("device_id", null) ?: UUID.randomUUID().toString().also {
                            prefs.edit().putString("device_id", it).commit()
                        }
                        val json = buildJsonObject {
                            put("platform", "android"); put("environment", "production")
                            put("bundleId", "ai.nuphos.android"); put("projectId", project)
                            put("deviceId", device); put("token", fcmToken)
                        }
                        val request = Http.authorizedGet("${NuphosApi.BASE_URL}/push/devices", expected.second)
                            .newBuilder().put(json.toString().toRequestBody(Http.jsonMedia)).build()
                        Http.client.newCall(request).execute().use { it.isSuccessful }
                    }.getOrDefault(false)
                    if (ok) {
                        val accepted = synchronized(bindingLock) {
                            if (login != expected || !ai.nuphos.android.session.AiAccess.allows(expected.second)) false
                            else {
                                registration = expected.first to fcmToken
                                prefs.edit().putString("account", expected.first)
                                    .putString("login_hash", fingerprint(expected.second)).putBoolean("consent_granted", true).commit()
                                true
                            }
                        }
                        if (!accepted) runCatching { unregister(expected.second, fcmToken) }
                        return@withLock
                    }
                    delay(1000L shl attempt)
                }
            }
        }
    }

    private fun unregister(auth: String, token: String) {
        val url = "${NuphosApi.BASE_URL}/push/devices".toHttpUrl().newBuilder()
            .addPathSegment(token).addQueryParameter("platform", "android").build()
        val request = Request.Builder().url(url).delete().header("Authorization", "Bearer $auth")
            .header("x-atlas-client", Http.clientHeader()).build()
        Http.client.newCall(request).execute().close()
    }

    fun receive(data: Map<String, String>) {
        synchronized(bindingLock) {
            if (!prefs.getBoolean("consent_granted", false)) return
            val savedToken = app.tokenStore.read() ?: return
            val account = prefs.getString("account", null) ?: return
            if (!PushBindingPolicy.accepts(account, prefs.getString("login_hash", null),
                    fingerprint(savedToken), data["accountId"], started > 0)) return
            val target = LocalNotificationTarget.from(account, data["teamId"], data["sessionId"]) ?: return
            // Tap routing re-checks current account, team and consent as well.
            LocalNotifications(app, { account }, { prefs.getBoolean("consent_granted", false) }).post(
                target, "Nuphos", data["body"]?.take(200) ?: "Open Nuphos to view the update")
        }
    }

    override fun onActivityStarted(activity: Activity) { started++ }
    override fun onActivityStopped(activity: Activity) { started-- }
    override fun onActivityCreated(activity: Activity, state: Bundle?) = Unit
    override fun onActivityResumed(activity: Activity) {
        val auth = app.authSession
        if (auth.state !is ai.nuphos.android.session.AuthSession.State.Restoring)
            sync(auth.user?.id, auth.token, auth.aiAllowed)
        requestToken()
    }
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}
