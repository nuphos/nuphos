package ai.nuphos.android

import ai.nuphos.android.data.Http
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody

/** Fixtures that predate Chats answer the chat listing with no chats, outside their own request log. */
object ChatsFixture {
    fun isListing(request: Request) =
        request.url.encodedPath == "/agent/conversations" && request.url.queryParameter("kind") == "channel"

    fun empty(request: Request): Response = Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200)
        .message("fixture").body("""{"conversations":[],"hasMore":false}""".toResponseBody(Http.jsonMedia)).build()
}
