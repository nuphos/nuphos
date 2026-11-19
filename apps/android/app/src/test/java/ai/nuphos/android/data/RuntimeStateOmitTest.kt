package ai.nuphos.android.data

import ai.nuphos.android.session.ChannelSession
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

/** #3526: reads that never show a runtime leave it out; with it, a read is about 10x slower. */
class RuntimeStateOmitTest {
    private val runtimeStates = mutableListOf<String?>()
    private val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
    private lateinit var original: OkHttpClient

    @Before fun before() {
        original = field.get(null) as OkHttpClient
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()

            runtimeStates += request.url.queryParameter("runtimeState")
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body("""{"kind":"channel","title":"c","messageCount":0,"messages":[]}""".toResponseBody(Http.jsonMedia)).build()
        }.build())
    }

    @After fun after() = field.set(null, original)

    @Test fun aBotChatsReadsAndPollsLeaveOutTheRuntime() = runTest {
        ChannelSession.Api("synthetic", "507f1f77bcf86cd799439011", "fixture-chat").detail(50)
        assertEquals(listOf("omit"), runtimeStates)
    }
}
