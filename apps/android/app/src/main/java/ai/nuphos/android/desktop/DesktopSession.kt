package ai.nuphos.android.desktop

import ai.nuphos.android.data.Http
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.data.AccountApi
import androidx.compose.runtime.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.RequestBody.Companion.toRequestBody
import okio.ByteString.Companion.decodeBase64
import okio.ByteString.Companion.toByteString
import java.io.IOException

/** Each connection starts watching. Its captured identity must remain valid for every operation. */
internal class DesktopSession(
    private val token: String, private val team: String, private val conversation: String,
    private val scope: CoroutineScope, private val current: () -> Boolean,
    private val calls: OkHttpClient = Http.client,
    private val endpoint: String = NuphosApi.BASE_URL,
    private val timing: DesktopTiming = DesktopTiming(),
) {
    enum class Phase { Connecting, Live, Failed, Closed }
    var phase by mutableStateOf(Phase.Closed); private set
    var controlling by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var width by mutableIntStateOf(0); private set
    var height by mutableIntStateOf(0); private set
    var picture by mutableStateOf<IntArray?>(null); private set
    var display by mutableIntStateOf(-1); private set
    var onVideo: ((Int,Int,ByteArray,Int) -> Unit)? = null
    private var job: Job? = null
    private var socket: WebSocket? = null
    private var opening: Call? = null
    private var protocol: RfbProtocol? = null
    private var generation=0
    private var textRevision=0
    var typing by mutableStateOf(false); private set
    private val heldKeys=mutableSetOf<Int>()
    private var pointerX=0; private var pointerY=0
    private fun active(g: Int)=g==generation && current()
    fun start() {
        if(job!=null || !current()) return
        val owner=++generation
        job=scope.launch {
            var failures=0
            while(active(owner)) {
                phase=Phase.Connecting; controlling=false; error=null
                try { connect(owner) }
                catch(e: CancellationException) { throw e }
                catch(e: Exception) { if(!active(owner)) break; if(e is IllegalArgumentException) { phase=Phase.Failed; error=e.message ?: "Unsupported desktop stream."; break }; failures++; if(failures>=timing.maxFailures) { phase=Phase.Failed; error=if(e is DesktopStalled) "The desktop stopped responding. Retry to reconnect." else "Could not connect to this desktop. Check the computer and try again."; break } }
                if(active(owner)) delay(minOf(15_000L,1000L shl minOf(failures,4)))
            }
        }
    }
    fun retry() { stop(); start() }
    fun fail(message: String) { stop(); error=message; phase=Phase.Failed }
    fun stop() {
        // Release held inputs while this connection still owns control, then close even if identity was revoked.
        if(controlling) {
            for(key in heldKeys) socket?.send(RfbProtocol.key(key,false).toByteString().base64())
            socket?.send(RfbProtocol.pointer(0,pointerX,pointerY).toByteString().base64())
            socket?.send("{\"t\":\"control\",\"owner\":\"agent\"}")
        }
        generation++; textRevision++; typing=false; controlling=false; heldKeys.clear(); job?.cancel(); job=null
        opening?.cancel(); opening=null; socket?.cancel(); socket=null; protocol=null
        picture=null; width=0; height=0; phase=Phase.Closed
    }
    fun control(human: Boolean) {
        if(phase!=Phase.Live || !current()) { stop(); return }
        if(!human) { textRevision++; typing=false; for(key in heldKeys) input(RfbProtocol.key(key,false)); heldKeys.clear(); input(RfbProtocol.pointer(0,pointerX,pointerY)) }
        if(socket?.send("{\"t\":\"control\",\"owner\":\"${if(human) "human" else "agent"}\"}")==true) controlling=human
        else stop()
    }
    private fun input(bytes: ByteArray) {
        if(current() && phase==Phase.Live && controlling) socket?.send(bytes.toByteString().base64())
    }
    fun pointer(x: Float,y: Float,buttons: Int) { if(width>0 && height>0) { pointerX=x.toInt().coerceIn(0,width-1); pointerY=y.toInt().coerceIn(0,height-1); input(RfbProtocol.pointer(buttons,pointerX,pointerY)) } }
    fun key(code: Int) { input(RfbProtocol.key(code,true)); input(RfbProtocol.key(code,false)) }
    fun modifier(code: Int,down: Boolean) { if(!controlling || !current()) return; if(down) heldKeys+=code else heldKeys-=code; input(RfbProtocol.key(code,down)) }
    fun type(text: String): Boolean {
        if(typing || !controlling || !current() || text.length !in 1..4096) return false
        val owner=generation; val revision=++textRevision; typing=true
        scope.launch {
            try { for(code in text.codePoints().toArray()) {
                if(!active(owner) || !controlling || revision!=textRevision) break
                key(if(code==10)0xff0d else if(code in 32..255)code else 0x01000000 or code); delay(40)
            } } finally { if(revision==textRevision)typing=false }
        }
        return true
    }
    fun keyframe() { protocol?.request(false) }
    private suspend fun connect(owner: Int) {
        val base=endpoint.toHttpUrl().newBuilder().addPathSegment("teams").addPathSegment(team)
            .addPathSegment("runtime-desktop").addPathSegment(conversation).build()
        val opened=withContext(Dispatchers.IO) {
            val call=calls.newCall(authorize(Request.Builder().url(base).post("{}".toRequestBody(Http.jsonMedia))).build())
            opening=call
            if(!active(owner)) { call.cancel(); throw CancellationException() }
            try { call.execute().use { response ->
                require(response.isSuccessful) { "Desktop is not available to this account." }
                val body=response.body ?: throw IOException("No desktop response")
                require(body.contentLength()<=4096)
                val source=body.source(); require(!source.request(4097));
                Json.parseToJsonElement(source.readUtf8()).jsonObject["display"]?.jsonPrimitive?.intOrNull?.also { require(it in 0..65535) }
                    ?: throw IOException("Invalid desktop display")
            } } finally { if(opening===call) opening=null }
        }
        ensureCurrent(owner); display=opened
        val chunks=Channel<ByteArray>(64)
        val bufferedBytes=java.util.concurrent.atomic.AtomicInteger()
        val url=base.newBuilder().addPathSegment(opened.toString()).build()
        val ws=calls.newBuilder().pingInterval(15,java.util.concurrent.TimeUnit.SECONDS).build().newWebSocket(authorize(Request.Builder().url(url)).build(),object: WebSocketListener() {
            override fun onMessage(webSocket: WebSocket,text: String) {
                if(!active(owner) || text.length>RfbProtocol.MAX_BYTES*4/3+4) { webSocket.cancel(); chunks.close(IOException("Invalid desktop frame")); return }
                val bytes=text.decodeBase64()?.toByteArray()
                if(bytes!=null && bytes.isEmpty()) return
                if(bytes==null || bytes.size>RfbProtocol.MAX_BYTES || bufferedBytes.addAndGet(bytes.size)>RfbProtocol.MAX_BYTES*2 || chunks.trySend(bytes).isFailure) { webSocket.cancel(); chunks.close(IOException("Desktop stream cannot keep up")) }
            }
            override fun onClosing(webSocket: WebSocket,code: Int,reason: String) { webSocket.close(code,null); chunks.close() }
            override fun onMessage(webSocket: WebSocket,bytes: okio.ByteString) { webSocket.cancel(); chunks.close(IOException("Invalid desktop frame")) }
            override fun onFailure(webSocket: WebSocket,t: Throwable,response: Response?) { chunks.close(IOException("Desktop connection ended")) }
            override fun onClosed(webSocket: WebSocket,code: Int,reason: String) { chunks.close() }
        })
        if(!active(owner)) { ws.cancel(); throw CancellationException() }; socket=ws
        val rfbReady=java.util.concurrent.atomic.AtomicBoolean(); val receivedPicture=java.util.concurrent.atomic.AtomicBoolean(); val idle=java.util.concurrent.atomic.AtomicBoolean()
        val handshakeDeadline=desktopNow()+timing.handshakeMillis
        val pictureDeadline=java.util.concurrent.atomic.AtomicLong(Long.MAX_VALUE)
        val connectionProtocol=java.util.concurrent.atomic.AtomicReference<RfbProtocol?>()
        val refresh=scope.launch {
            while(active(owner)) {
                delay(timing.refreshMillis)
                if(rfbReady.get()) { pictureDeadline.set(desktopNow()+timing.frameMillis); receivedPicture.set(false); connectionProtocol.get()?.request(false) }
            }
        }
        try {
            withContext(Dispatchers.IO) {
                var buffered=ByteArray(0); var offset=0
                suspend fun read(count: Int): ByteArray {
                    require(count in 0..(RfbProtocol.MAX_PIXELS*4).toInt())
                    val result=ByteArray(count); var at=0; val progressDeadline=desktopNow()+timing.progressMillis
                    while(at<count) {
                        ensureCurrent(owner)
                        if(offset==buffered.size) {
                            val deadline=if(!rfbReady.get())handshakeDeadline else if(!receivedPicture.get()) { if(idle.get())pictureDeadline.get() else minOf(pictureDeadline.get(),progressDeadline) } else if(idle.get())Long.MAX_VALUE else progressDeadline
                            val remaining=deadline-desktopNow()
                            if(remaining<=0)throw DesktopStalled()
                            val next=withTimeoutOrNull(minOf(remaining,1000L)) { chunks.receive() } ?: continue
                            buffered=next; bufferedBytes.addAndGet(-buffered.size); offset=0
                        }
                        val n=minOf(count-at,buffered.size-offset); buffered.copyInto(result,at,offset,offset+n); at+=n; offset+=n
                    }
                    return result
                }
                val rfb=RfbProtocol(::read,{ bytes -> if(active(owner)) ws.send(bytes.toByteString().base64()) },
                    ready={ w,h -> if(active(owner)) { pictureDeadline.set(desktopNow()+timing.frameMillis); rfbReady.set(true); width=w; height=h } },
                    frame={ w,h,pixels -> if(active(owner)) { receivedPicture.set(true); width=w; height=h; picture=pixels; phase=Phase.Live } },
                    video={ w,h,bytes,flags -> if(active(owner)) { receivedPicture.set(true); picture=null; onVideo?.invoke(w,h,bytes,flags); phase=Phase.Live } },
                    waiting={ idle.set(it) })
                protocol=rfb; connectionProtocol.set(rfb)
                rfb.use { it.run() }
            }
        } finally {
            refresh.cancel(); ws.cancel(); chunks.cancel()
            if(active(owner)) { socket=null; protocol=null; controlling=false; heldKeys.clear(); phase=Phase.Connecting }
        }
    }
    private fun ensureCurrent(owner: Int) { if(!active(owner)) throw CancellationException() }
    private fun authorize(builder: Request.Builder)=builder.header("Authorization","Bearer $token")
        .header("x-nuphos-ai-consent-version",AccountApi.AI_CONSENT_VERSION).header("x-atlas-client",Http.clientHeader())
}

internal data class DesktopTiming(val handshakeMillis: Long=10_000,val frameMillis: Long=20_000,val progressMillis: Long=10_000,val refreshMillis: Long=30_000,val maxFailures: Int=6)
private class DesktopStalled : IOException()
private fun desktopNow()=System.nanoTime()/1_000_000
