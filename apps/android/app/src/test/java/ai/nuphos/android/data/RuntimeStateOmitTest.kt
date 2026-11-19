package ai.nuphos.android.data

import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Test

/** #3526: a read that never shows the runtime leaves it out; with it, a read is about 10x slower. */
class RuntimeStateOmitTest {
    @Test fun onlyTheReadThatAsksLeavesOutTheRuntime() = runTest {
        val runtimeStates = mutableListOf<String?>()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()

            runtimeStates += request.url.queryParameter("runtimeState")
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body("""{"kind":"channel","title":"c","messageCount":0,"messages":[]}""".toResponseBody(Http.jsonMedia)).build()
        }.build()

        NuphosApi.conversationDetail(client, "synthetic", "507f1f77bcf86cd799439011", "fixture-chat", tail = 1, runtimeState = false)
        NuphosApi.conversationDetail(client, "synthetic", "507f1f77bcf86cd799439011", "fixture-chat")
        assertEquals(listOf("omit", null), runtimeStates)
    }
}
