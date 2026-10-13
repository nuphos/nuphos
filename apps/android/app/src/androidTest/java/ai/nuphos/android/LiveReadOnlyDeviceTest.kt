package ai.nuphos.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.AccountApi
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.testing.*
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class LiveReadOnlyDeviceTest {
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).build()

    private fun request(path: String, token: String? = null, body: JsonObject? = null): JsonObject {
        val builder = Request.Builder().url("${NuphosApi.BASE_URL}/$path")
            .header("Accept", "application/json").header("x-atlas-client", Http.clientHeader())
        if (token != null) builder.header("Authorization", "Bearer $token")
        if (path.startsWith("agent/")) builder.header("x-nuphos-ai-consent-version", AccountApi.AI_CONSENT_VERSION)
        if (body != null) builder.post(body.toString().toRequestBody(Http.jsonMedia))
        return try {
            client.newCall(builder.build()).execute().use {
                check(it.isSuccessful) { "Live API returned HTTP ${it.code}." }
                Http.json.parseToJsonElement(it.body.string()).jsonObject
            }
        } catch (_: Exception) {
            throw IllegalStateException("Live request failed; details withheld.")
        }
    }

    @Test fun configuredAccountCanReadItsTeamHistory() {
        val arguments = InstrumentationRegistry.getArguments()
        assumeTrue("Live tests are disabled by default.", arguments.getString("e2eLive") == "true")
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
        val name = arguments.getString("e2eConfig") ?: error("Missing live test configuration.")
        check(name.matches(Regex("e2e-[a-f0-9]{32}\\.json"))) { "Invalid config file name." }
        val file = File(app.filesDir, name)
        val beforeToken = app.tokenStore.read()
        val beforePrefs = app.getSharedPreferences("nuphos.prefs", 0).all.toMap()
        try {
            val config = try { Http.json.decodeFromString<E2eConfig>(file.readText()) }
                catch (_: Exception) { error("Invalid live test configuration; values withheld.") }
            val gateway = object : E2eGateway {
                override fun login(email: String, password: String): String {
                    val json = request("auth/password/sign-in", body = buildJsonObject { put("email", email); put("password", password) })
                    return json["token"]?.jsonPrimitive?.contentOrNull ?: error("No session returned.")
                }
                override fun identity(token: String): E2eIdentity {
                    val user = request("auth/me", token)
                    check(!user["id"]?.jsonPrimitive?.contentOrNull.isNullOrBlank()) { "Invalid account response." }
                    val teams = request("teams", token)["teams"]?.jsonArray ?: error("Missing team response.")
                    val consent = request("auth/ai-consent", token)
                    return E2eIdentity(user["email"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                        teams.map { it.jsonObject["id"]?.jsonPrimitive?.contentOrNull.orEmpty() }.toSet(),
                        consent["version"]?.jsonPrimitive?.contentOrNull == AccountApi.AI_CONSENT_VERSION &&
                            consent["accepted"]?.jsonPrimitive?.booleanOrNull == true)
                }
            }
            val token = E2eSetup.prepare(config, beforeToken, gateway, app.tokenStore::write)
            val page = request("agent/conversations?teamId=${config.teamId}&limit=1&scope=mine", token)
            check(page["conversations"] is JsonArray) { "Missing conversation list." }
            if (config.mode == "existing-session") check(beforeToken == app.tokenStore.read()) { "Installed session changed; values withheld." }
        } finally {
            file.delete()
            check(beforePrefs == app.getSharedPreferences("nuphos.prefs", 0).all) { "Selected workspace changed; values withheld." }
        }
    }
}
