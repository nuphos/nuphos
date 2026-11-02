package ai.nuphos.android.desktop

import java.net.ServerSocket
import java.net.Socket
import java.net.InetAddress
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.*
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import org.junit.Assert.*
import org.junit.Test

class DesktopRecoveryTest {
    private val timing=DesktopTiming(handshakeMillis=100,frameMillis=100,progressMillis=100,refreshMillis=1000,maxFailures=1)
    @Test fun acceptedSocketWithoutBannerAndPartialBannerReachRetryableFailure()=runBlocking {
        for(partial in listOf(false,true)) SilentRelay(partial).use { relay ->
            val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
            val session=DesktopSession("synthetic","team","chat",scope,{true},OkHttpClient(),relay.url,timing)
            try {
                session.start();withTimeout(3000){while(session.phase!=DesktopSession.Phase.Failed)delay(10)}
                assertTrue(session.error!!.contains("stopped responding"));assertFalse(session.controlling)
                assertTrue(withContext(Dispatchers.IO){relay.closed.await(1,TimeUnit.SECONDS)})
                session.retry();assertFalse(session.controlling);assertEquals(DesktopSession.Phase.Connecting,session.phase)
            } finally {session.stop();scope.cancel()}
        }
    }
    @Test fun scopedCancellationDuringHandshakeDoesNotBecomeATimeoutFailure()=runBlocking {
        SilentRelay(false).use {relay ->
            val allowed=AtomicBoolean(true);val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
            val session=DesktopSession("synthetic","team","chat",scope,{allowed.get()},OkHttpClient(),relay.url,timing.copy(handshakeMillis=2000))
            try {
                session.start();assertTrue(withContext(Dispatchers.IO){relay.accepted.await(1,TimeUnit.SECONDS)})
                allowed.set(false);session.stop()
                assertTrue(withContext(Dispatchers.IO){relay.closed.await(1,TimeUnit.SECONDS)})
                assertEquals(DesktopSession.Phase.Closed,session.phase);assertNull(session.error);assertFalse(session.controlling)
            } finally {session.stop();scope.cancel()}
        }
    }
    @Test fun failingDrainClosesOnceShowsFailureAndExplicitRetryStartsWithoutControl()=runBlocking {
        var drains=0;var closes=0;var fail=true
        val recovery=DesktopDecodeRecovery({drains++;if(fail)throw IllegalStateException("synthetic codec")},{closes++})
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Unconfined)
        val session=DesktopSession("synthetic","team","chat",scope,{true},OkHttpClient(),"http://127.0.0.1:1",timing)
        try {
            @Suppress("UNCHECKED_CAST")
            (DesktopSession::class.java.getDeclaredField("controlling\$delegate").apply { isAccessible=true }.get(session) as androidx.compose.runtime.MutableState<Boolean>).value=true
            if(recovery.tick())session.fail("Could not decode this desktop. Retry to start a fresh connection.")
            repeat(20){assertFalse(recovery.tick())}
            assertEquals(1,drains);assertEquals(1,closes);assertEquals(DesktopSession.Phase.Failed,session.phase)
            assertTrue(session.error!!.contains("Retry"));assertFalse(session.controlling)
            fail=false;recovery.reset();session.retry()
            assertEquals(DesktopSession.Phase.Connecting,session.phase);assertFalse(session.controlling);assertFalse(recovery.tick());assertEquals(2,drains)
        } finally {session.stop();scope.cancel()}
    }
}

/** Only a local synthetic HTTP upgrade, with no desktop behind it. */
private class SilentRelay(private val partial: Boolean): AutoCloseable {
    private val server=ServerSocket(0,16,InetAddress.getLoopbackAddress())
    private val sockets=ConcurrentHashMap.newKeySet<Socket>()
    private val pool=Executors.newCachedThreadPool { r -> Thread(r,"synthetic-relay").apply { isDaemon=true } }
    val accepted=CountDownLatch(1);val closed=CountDownLatch(1)
    val url="http://127.0.0.1:${server.localPort}"
    init {pool.execute {while(!server.isClosed) {val socket=try{server.accept()}catch(_:Exception){break};sockets+=socket;pool.execute {handle(socket)}}}}
    private fun handle(socket: Socket) {
        try {socket.use {
            val input=socket.getInputStream();val output=socket.getOutputStream()
            fun line(): String {val bytes=java.io.ByteArrayOutputStream();while(true){val b=input.read();if(b<0)throw java.io.EOFException();if(b==10)break;bytes.write(b)};return bytes.toString("US-ASCII").trimEnd('\r')}
            val request=line();val headers=mutableMapOf<String,String>()
            while(true){val l=line();if(l.isEmpty())break;headers[l.substringBefore(':').lowercase()]=l.substringAfter(':').trim()}
            if(request.startsWith("POST")) {
                repeat(headers["content-length"]?.toInt() ?: 0){input.read()}
                val body="{\"display\":1}";output.write("HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n$body".toByteArray());output.flush()
            } else {
                val accept=Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1").digest((headers.getValue("sec-websocket-key")+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").toByteArray()))
                output.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: $accept\r\n\r\n".toByteArray())
                if(partial){val text=Base64.getEncoder().encode("RFB 0".toByteArray());output.write(byteArrayOf(0x81.toByte(),text.size.toByte())+text)}
                output.flush();accepted.countDown();while(input.read()!=-1){};closed.countDown()
            }
        }}catch(_:Exception){}finally{sockets-=socket}
    }
    override fun close(){server.close();sockets.forEach{runCatching{it.close()}};pool.shutdownNow()}
}
