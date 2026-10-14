package ai.nuphos.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.NuphosApi
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Explicitly opted-in, clean-device bootstrap against an isolated loopback backend only. */
@RunWith(AndroidJUnit4::class)
class LocalPushBootstrapDeviceTest {
    @Test fun bootstrapVerifiedLocalFixtureAccount() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("localPushBootstrap") == "true")
        check(BuildConfig.DEBUG && NuphosApi.BASE_URL.startsWith("http://127.0.0.1:"))
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
        val file = File(app.filesDir, "local-fcm-bootstrap.json")
        try {
            val config = Http.json.parseToJsonElement(file.readText()).jsonObject
            val token = config.getValue("token").jsonPrimitive.content
            val existing = app.tokenStore.read()
            check(existing == null || existing == token) { "Refusing to replace a different login" }
            val expectedId = config.getValue("userId").jsonPrimitive.content
            val expectedEmail = config.getValue("email").jsonPrimitive.content
            check(expectedEmail.endsWith("@example.test"))
            val request = Request.Builder().url("${NuphosApi.BASE_URL}/auth/me")
                .header("Authorization", "Bearer $token").build()
            OkHttpClient().newCall(request).execute().use {
                check(it.isSuccessful) { "Local identity verification failed" }
                val user = Http.json.parseToJsonElement(it.body.string()).jsonObject
                assertEquals(expectedId, user.getValue("id").jsonPrimitive.content)
                assertEquals(expectedEmail, user.getValue("email").jsonPrimitive.content)
            }
            app.tokenStore.write(token)
            check(app.tokenStore.read() == token) { "Local token write failed" }
            InstrumentationRegistry.getInstrumentation().runOnMainSync { app.authSession.restore() }
            val deadline = android.os.SystemClock.elapsedRealtime() + 15000
            while (app.authSession.state is ai.nuphos.android.session.AuthSession.State.Restoring && android.os.SystemClock.elapsedRealtime() < deadline) {
                android.os.SystemClock.sleep(100)
            }
            check(app.authSession.state is ai.nuphos.android.session.AuthSession.State.SignedIn) { "Local app session restoration failed" }
        } finally { file.delete() }
    }
}
