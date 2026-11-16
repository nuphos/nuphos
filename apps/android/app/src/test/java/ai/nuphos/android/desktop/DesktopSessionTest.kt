package ai.nuphos.android.desktop

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import org.junit.Assert.*
import org.junit.Test

class DesktopSessionTest {
    @Test fun revokedOwnerCannotOpenOrTakeControl()=runBlocking {
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Default)
        val session=DesktopSession("synthetic","team","chat",scope,{false},OkHttpClient(),"http://127.0.0.1:1")
        session.start();session.control(true);session.type("not authorized")
        assertEquals(DesktopSession.Phase.Closed,session.phase);assertFalse(session.controlling);scope.cancel()
    }
    @Test fun ownerChangeDuringOpenCannotAttachTheReturnedDesktop()=runBlocking {
        val entered=CountDownLatch(1);val reply=CountDownLatch(1);val attaches=AtomicInteger();val allowed=AtomicBoolean(true)
        val server=HttpServer.create(InetSocketAddress("127.0.0.1",0),0)
        server.createContext("/") { exchange ->
            if(exchange.requestMethod=="GET")attaches.incrementAndGet()
            entered.countDown();reply.await(3,TimeUnit.SECONDS)
            val bytes="{\"display\":1}".toByteArray()
            runCatching { exchange.sendResponseHeaders(200,bytes.size.toLong());exchange.responseBody.use { it.write(bytes) } };exchange.close()
        }
        server.start();val scope=CoroutineScope(SupervisorJob()+Dispatchers.Default)
        val session=DesktopSession("synthetic","team","chat",scope,{allowed.get()},OkHttpClient(),"http://127.0.0.1:${server.address.port}")
        try {
            session.start();assertTrue(withContext(Dispatchers.IO){entered.await(3,TimeUnit.SECONDS)})
            allowed.set(false);session.stop();reply.countDown();delay(150)
            assertEquals(0,attaches.get());assertFalse(session.controlling);assertEquals(DesktopSession.Phase.Closed,session.phase)
        } finally {reply.countDown();session.stop();scope.cancel();server.stop(0)}
    }
    /** The error at the instant phase becomes Failed, read by a write observer on the thread that writes it. */
    private fun errorWhenFailed(session: DesktopSession): List<String?> {
        val seen=java.util.concurrent.CopyOnWriteArrayList<String?>()
        val observer=androidx.compose.runtime.snapshots.Snapshot.registerGlobalWriteObserver {
            if(seen.isEmpty() && session.phase==DesktopSession.Phase.Failed) seen.add(session.error)
        }
        try { session.start(); runBlocking { withTimeout(5000){while(session.phase!=DesktopSession.Phase.Failed)delay(10)} } }
        finally { observer.dispose(); session.stop() }
        return seen
    }
    @Test fun aRefusedDesktopIsNeverFailedWithoutItsError() {
        val server=HttpServer.create(InetSocketAddress("127.0.0.1",0),0)
        server.createContext("/") { exchange ->exchange.sendResponseHeaders(403,-1);exchange.close() };server.start()
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Default)
        try {
            val seen=errorWhenFailed(DesktopSession("synthetic","team","chat",scope,{true},OkHttpClient(),"http://127.0.0.1:${server.address.port}"))
            assertEquals(1,seen.size);assertNotNull("Failed was shown before its error",seen.single())
        } finally {scope.cancel();server.stop(0)}
    }
    @Test fun anUnreachableDesktopIsNeverFailedWithoutItsError() {
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Default)
        try {
            val seen=errorWhenFailed(DesktopSession("synthetic","team","chat",scope,{true},OkHttpClient(),"http://127.0.0.1:1",DesktopTiming(maxFailures=1)))
            assertEquals(1,seen.size);assertNotNull("Failed was shown before its error",seen.single())
        } finally {scope.cancel()}
    }
    @Test fun backendRefusalIsVisibleAndDoesNotRetryOrControl()=runBlocking {
        val hits=AtomicInteger();val server=HttpServer.create(InetSocketAddress("127.0.0.1",0),0)
        server.createContext("/") { exchange ->hits.incrementAndGet();exchange.sendResponseHeaders(403,-1);exchange.close() };server.start()
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Default)
        val session=DesktopSession("synthetic","team","chat",scope,{true},OkHttpClient(),"http://127.0.0.1:${server.address.port}")
        try {
            session.start();withTimeout(3000){while(session.phase!=DesktopSession.Phase.Failed)delay(10)}
            assertEquals(1,hits.get());assertFalse(session.controlling);assertTrue(session.error!!.contains("not available"))
        } finally {session.stop();scope.cancel();server.stop(0)}
    }
}
