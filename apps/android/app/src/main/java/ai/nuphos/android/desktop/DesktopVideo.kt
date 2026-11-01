package ai.nuphos.android.desktop

import android.media.MediaCodec
import android.media.MediaFormat
import android.view.Surface
import java.nio.ByteBuffer

/** Codec work belongs to the stream worker; no microphone, clipboard or file access. */
internal class DesktopVideo {
    private var surface: Surface?=null
    private var codec: MediaCodec?=null
    private var parameters: List<ByteArray> = emptyList()
    private var waiting=true
    @Synchronized fun surface(value: Surface?) { close(); surface=value }
    @Synchronized fun close() { runCatching { codec?.stop() }; runCatching { codec?.release() }; codec=null; parameters=emptyList(); waiting=true }
    @Synchronized fun frame(w: Int,h: Int,data: ByteArray,flags: Int) {
        if(flags and 3 != 0) close()
        val target=surface ?: return
        val units=annexB(data); val sps=units.firstOrNull { it[0].toInt() and 31 == 7 }; val pps=units.firstOrNull { it[0].toInt() and 31 == 8 }
        if(sps!=null && pps!=null && (parameters.size!=2 || !parameters[0].contentEquals(sps) || !parameters[1].contentEquals(pps))) {
            close()
            val format=MediaFormat.createVideoFormat("video/avc",w,h)
            format.setByteBuffer("csd-0",ByteBuffer.wrap(byteArrayOf(0,0,0,1)+sps)); format.setByteBuffer("csd-1",ByteBuffer.wrap(byteArrayOf(0,0,0,1)+pps))
            val decoder=MediaCodec.createDecoderByType("video/avc")
            try { decoder.configure(format,target,null,0); decoder.start(); codec=decoder; parameters=listOf(sps,pps) }
            catch(e: Exception) { decoder.release(); throw e }
        }
        val decoder=codec ?: return
        val isKey=units.any { it[0].toInt() and 31 == 5 }
        if(waiting && !isKey) return
        waiting=false
        val info=MediaCodec.BufferInfo()
        fun drain() { while(true) { val out=decoder.dequeueOutputBuffer(info,0); if(out>=0) decoder.releaseOutputBuffer(out,true) else if(out==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) continue else break } }
        drain()
        val index=decoder.dequeueInputBuffer(10_000)
        require(index>=0) { "Video decoder cannot keep up." }
        val input=requireNotNull(decoder.getInputBuffer(index)); require(input.capacity()>=data.size); input.clear(); input.put(data)
        decoder.queueInputBuffer(index,0,data.size,System.nanoTime()/1000,0); drain()
    }
    @Synchronized fun drain() {
        val decoder=codec ?: return; val info=MediaCodec.BufferInfo()
        while(true) { val index=decoder.dequeueOutputBuffer(info,0); if(index>=0)decoder.releaseOutputBuffer(index,true) else if(index==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED)continue else break }
    }
    companion object {
        fun annexB(data: ByteArray): List<ByteArray> {
            val starts=mutableListOf<Pair<Int,Int>>(); var i=0
            while(i+2<data.size) { if(data[i]==0.toByte() && data[i+1]==0.toByte()) {
                val length=if(data[i+2]==1.toByte())3 else if(i+3<data.size && data[i+2]==0.toByte() && data[i+3]==1.toByte())4 else 0
                if(length>0) { starts+=i to length; i+=length; continue }
            }; i++ }
            return starts.mapIndexedNotNull { n,(at,length) -> val end=starts.getOrNull(n+1)?.first ?: data.size; if(end>at+length)data.copyOfRange(at+length,end) else null }
        }
    }
}
