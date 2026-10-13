package ai.nuphos.android.data

import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.net.Socket
import java.net.URI
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.Executors
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.TimeUnit

class NativeLoginTest {
    private class Fixture {
        @Volatile var registration: JsonObject? = null
        val requests = java.util.concurrent.CopyOnWriteArrayList<okhttp3.Request>()
        @Volatile var redeemed: JsonObject? = null
        var status = 200
        val code = "c".repeat(43)
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            requests.add(request)
            val body = Http.json.parseToJsonElement(Buffer().also { request.body!!.writeTo(it) }.readUtf8()).jsonObject
            val response = if (request.url.encodedPath.endsWith("/redeem")) {
                redeemed = body
                """{"token":"synthetic-session-token"}"""
            } else {
                registration = body
                """{"handle":"${"h".repeat(43)}","expiresInSec":600}"""
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                .code(status).message("fixture").body(response.toResponseBody(Http.jsonMedia)).build()
        }.build()
        fun delivery(extra: String? = null): String {
            val body = requireNotNull(registration)
            val state = body["clientState"]!!.jsonPrimitive.content
            return "/callback?state=$state&${extra ?: "code=$code"}"
        }
        fun hit(target: String): String {
            val port = URI(requireNotNull(registration)["redirectUri"]!!.jsonPrimitive.content).port
            return Socket("127.0.0.1", port).use { socket ->
                socket.soTimeout = 3_000
                socket.getOutputStream().write("GET $target HTTP/1.1\r\nHost: 127.0.0.1:$port\r\n\r\n".toByteArray())
                socket.getInputStream().bufferedReader().readText()
            }
        }
    }

    @Test fun nativeFlowRegistersBoundLoopbackAndRedeemsOnlyDeliveredCode() {
        val fixture = Fixture()
        NativeLogin(fixture.client).use { login ->
            val url = login.register()
            assertEquals("https://nuphos.ai/api/google/start?handle=${"h".repeat(43)}", url)
            val executor = Executors.newSingleThreadExecutor()
            try {
                val result = executor.submit<String> { login.awaitToken() }
                assertTrue(fixture.hit(fixture.delivery()).startsWith("HTTP/1.1 200"))
                assertEquals("synthetic-session-token", result.get(3, TimeUnit.SECONDS))
                assertTrue(login.receivedCallback)
                val registration = fixture.registration!!
                val redeemed = fixture.redeemed!!
                assertEquals("S256", registration["codeChallengeMethod"]!!.jsonPrimitive.content)
                val verifier = redeemed["codeVerifier"]!!.jsonPrimitive.content
                val challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))
                assertEquals(challenge, registration["codeChallenge"]!!.jsonPrimitive.content)
                assertFalse(url.contains(verifier))
                assertFalse(url.contains(registration["clientState"]!!.jsonPrimitive.content))
                assertEquals(fixture.code, redeemed["code"]!!.jsonPrimitive.content)
                fixture.requests.forEach {
                    assertEquals("https", it.url.scheme)
                    assertEquals("api.nuphos.ai", it.url.host)
                    assertNull(it.header("Authorization"))
                }
                try { fixture.hit(fixture.delivery()); fail("Replay listener remained open") } catch (_: IOException) { }
                try { login.awaitToken(); fail("Attempt was reused") } catch (_: IOException) { }
                assertEquals(2, fixture.requests.size)
            } finally { executor.shutdownNow() }
        }
    }

    @Test fun deliveryWaitsForForegroundBeforeRedemptionAndCloseRejectsIt() {
        val fixture = Fixture()
        NativeLogin(fixture.client).use { login ->
            login.register()
            val executor = Executors.newSingleThreadExecutor()
            try {
                val delivery = executor.submit<String> { login.awaitDelivery() }
                assertTrue(fixture.hit(fixture.delivery()).startsWith("HTTP/1.1 200"))
                val code = delivery.get(3, TimeUnit.SECONDS)
                assertTrue(login.receivedCallback)
                assertNull(fixture.redeemed)
                assertEquals(1, fixture.requests.size)
                assertEquals("synthetic-session-token", login.redeem(code))
                assertEquals(2, fixture.requests.size)
            } finally { executor.shutdownNow() }
        }
        val canceled = Fixture()
        NativeLogin(canceled.client).use { login ->
            login.register()
            val executor = Executors.newSingleThreadExecutor()
            try {
                val delivery = executor.submit<String> { login.awaitDelivery() }
                canceled.hit(canceled.delivery())
                val code = delivery.get(3, TimeUnit.SECONDS)
                login.close()
                try { login.redeem(code); fail("Canceled delivery was redeemed") } catch (_: IOException) { }
                assertNull(canceled.redeemed)
            } finally { executor.shutdownNow() }
        }
    }

    @Test fun wrongStateDuplicateAndExternalTokensDoNotConsumeAttempt() {
        val fixture = Fixture()
        NativeLogin(fixture.client).use { login ->
            login.register()
            val executor = Executors.newSingleThreadExecutor()
            try {
                val result = executor.submit<String> { login.awaitToken() }
                for (target in listOf(
                    "/callback?state=wrong&code=${fixture.code}",
                    fixture.delivery("token=attacker-session"),
                    fixture.delivery() + "&state=duplicate", fixture.delivery("code=%ZZ"),
                    fixture.delivery() + "&error=denied",
                )) {
                    assertTrue(fixture.hit(target).startsWith("HTTP/1.1 400"))
                    assertFalse(login.receivedCallback)
                    assertNull(fixture.redeemed)
                }
                fixture.hit(fixture.delivery())
                assertEquals("synthetic-session-token", result.get(3, TimeUnit.SECONDS))
            } finally { executor.shutdownNow() }
        }
    }

    @Test fun providerFailureIsClaimedWithoutTokenExchange() {
        val fixture = Fixture()
        NativeLogin(fixture.client).use { login ->
            login.register()
            val executor = Executors.newSingleThreadExecutor()
            try {
                val result = executor.submit { login.awaitToken() }
                fixture.hit(fixture.delivery("error=access_denied"))
                try { result.get(3, TimeUnit.SECONDS); fail() }
                catch (e: java.util.concurrent.ExecutionException) { assertTrue(e.cause is IOException) }
                assertTrue(login.receivedCallback)
                assertNull(fixture.redeemed)
            } finally { executor.shutdownNow() }
        }
    }

    @Test fun cancellationClosesListenerAndCannotRedeemLateDelivery() {
        val fixture = Fixture()
        NativeLogin(fixture.client).use { login ->
            login.register()
            val executor = Executors.newSingleThreadExecutor()
            try {
                val result = executor.submit { login.awaitToken() }
                login.close()
                try { result.get(3, TimeUnit.SECONDS); fail() }
                catch (e: java.util.concurrent.ExecutionException) { assertTrue(e.cause is IOException) }
                try { fixture.hit(fixture.delivery()); fail() } catch (_: IOException) { }
                assertNull(fixture.redeemed)
            } finally { executor.shutdownNow() }
        }
    }

    @Test fun unavailableNativeEndpointNeverFallsBackToTokenLogin() {
        val fixture = Fixture().apply { status = 404 }
        NativeLogin(fixture.client).use { login ->
            try { login.register(); fail() } catch (_: IOException) { }
            assertEquals(1, fixture.requests.size)
            assertNull(fixture.redeemed)
        }
    }

    @Test fun expiredAttemptCannotDeliverOrRedeem() {
        val fixture = Fixture()
        NativeLogin(fixture.client, timeoutMs = 100).use { login ->
            login.register()
            Thread.sleep(150)
            try { login.awaitToken(); fail() } catch (_: java.net.SocketTimeoutException) { }
            assertNull(fixture.redeemed)
        }
    }
    @Test fun tricklingHeadersCannotBlockLegitimateDeliveryPastReadBudget() {
        val fixture = Fixture()
        NativeLogin(fixture.client, timeoutMs = 8_000).use { login ->
            login.register()
            val executor = Executors.newFixedThreadPool(2)
            val dripping = AtomicBoolean(true)
            val started = CountDownLatch(1)
            val port = URI(fixture.registration!!["redirectUri"]!!.jsonPrimitive.content).port
            val socket = Socket("127.0.0.1", port)
            try {
                val result = executor.submit<String> { login.awaitToken() }
                executor.submit {
                    try {
                        while (dripping.get()) {
                            socket.getOutputStream().write('G'.code)
                            socket.getOutputStream().flush()
                            started.countDown()
                            Thread.sleep(100)
                        }
                    } catch (_: IOException) { }
                }
                assertTrue(started.await(1, TimeUnit.SECONDS))
                Thread.sleep(1_250)
                assertFalse(login.receivedCallback)
                assertTrue(fixture.hit(fixture.delivery()).startsWith("HTTP/1.1 200"))
                assertEquals("synthetic-session-token", result.get(3, TimeUnit.SECONDS))
            } finally {
                dripping.set(false)
                socket.close()
                executor.shutdownNow()
            }
        }
    }

}
