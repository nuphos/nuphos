package ai.nuphos.android.desktop

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.EOFException

class RfbProtocolTest {
    private fun init(w: Int=2,h: Int=1)= "RFB 003.008\n".toByteArray()+byteArrayOf(1,1)+RfbProtocol.be32(0)+RfbProtocol.be16(w)+RfbProtocol.be16(h)+ByteArray(16)+RfbProtocol.be32(4)+"test".toByteArray()
    private fun rect(w: Int,h: Int,encoding: Int,body: ByteArray)=byteArrayOf(0,0,0,1)+RfbProtocol.be16(0)+RfbProtocol.be16(0)+RfbProtocol.be16(w)+RfbProtocol.be16(h)+RfbProtocol.be32(encoding)+body
    @Test fun handshakeAndRawPixelsUseTheRequestedFormat()=runBlocking {
        val bytes=init()+rect(2,1,0,byteArrayOf(0,0,(-1).toByte(),0,0,(-1).toByte(),0,0)); var offset=0
        val sent=mutableListOf<ByteArray>(); var pixels:IntArray?=null
        val rfb=RfbProtocol({ n -> if(offset+n>bytes.size)throw EOFException(); bytes.copyOfRange(offset,offset+n).also { offset+=n } },{sent+=it},{w,h->assertEquals(2,w);assertEquals(1,h)},{_,_,p->pixels=p},{_,_,_,_->fail()})
        try { rfb.run() } catch(_: EOFException) { } finally { rfb.close() }
        assertArrayEquals(intArrayOf(0xffff0000.toInt(),0xff00ff00.toInt()),pixels)
        assertEquals("RFB 003.008\n",String(sent.first())); assertEquals(2,sent.count { it[0]==3.toByte() })
    }
    @Test fun unsupportedSecurityNeverSendsAnAccountPassword()=runBlocking {
        val bytes="RFB 003.008\n".toByteArray()+byteArrayOf(1,30); var at=0; val sent=mutableListOf<ByteArray>()
        RfbProtocol({n->bytes.copyOfRange(at,at+n).also {at+=n}},{sent+=it},{_,_->},{_,_,_->},{_,_,_,_->}).use {
            try { it.run(); fail() } catch(e:IllegalArgumentException) { assertTrue(e.message!!.contains("Update Nuphos")) }
        }
        assertEquals(1,sent.size)
    }
    @Test fun oversizedFramebufferIsRejectedBeforeAllocation()=runBlocking {
        val bytes=init(8192,8192);var at=0
        RfbProtocol({n->bytes.copyOfRange(at,at+n).also {at+=n}},{},{_,_->},{_,_,_->},{_,_,_,_->}).use {
            try {it.run();fail()} catch(_:IllegalArgumentException) { }
        }
    }
    @Test fun zrleSolidPackedAndRunsDecode() {
        val red=byteArrayOf(0,0,(-1).toByte()); val green=byteArrayOf(0,(-1).toByte(),0)
        assertArrayEquals(IntArray(4){0xffff0000.toInt()},RfbProtocol.zrle(byteArrayOf(1)+red,2,2))
        assertArrayEquals(intArrayOf(0xffff0000.toInt(),0xff00ff00.toInt()),RfbProtocol.zrle(byteArrayOf(2)+red+green+byteArrayOf(0x40),2,1))
        assertArrayEquals(IntArray(4){0xffff0000.toInt()},RfbProtocol.zrle(byteArrayOf(128.toByte())+red+byteArrayOf(3),2,2))
        assertArrayEquals(intArrayOf(0xffff0000.toInt(),0xff00ff00.toInt()),RfbProtocol.zrle(byteArrayOf(130.toByte())+red+green+byteArrayOf(0,1),2,1))
    }
    @Test fun malformedRunsPaletteAndTruncatedTilesAreRejected() {
        for(bytes in listOf(byteArrayOf(128.toByte(),0,0,0,127),byteArrayOf(3,0,0,0,0,0,0,0,0,0,0xc0.toByte()),byteArrayOf(0))) {
            try { RfbProtocol.zrle(bytes,1,1);fail() } catch(_:IllegalArgumentException) { }
        }
    }
    @Test fun pointerNeverSetsTheExtendedRelayBit() { assertEquals(127,RfbProtocol.pointer(127,20,30)[1].toInt());try { RfbProtocol.pointer(128,0,0);fail() }catch(_:IllegalArgumentException){} }
    @Test fun h264AccessUnitsAcceptBothAnnexBStartCodes() {
        val units=DesktopVideo.annexB(byteArrayOf(0,0,0,1,0x67,1,0,0,1,0x68,2,0,0,0,1,0x65,3))
        assertEquals(3,units.size); assertArrayEquals(byteArrayOf(0x65,3),units.last())
    }
    @Test fun compressedRectanglesShareOneZlibStream()=runBlocking {
        val deflater=java.util.zip.Deflater();val parts=mutableListOf<ByteArray>()
        try { for(color in listOf(byteArrayOf(1,0,0,(-1).toByte()),byteArrayOf(1,0,(-1).toByte(),0))) {
            deflater.setInput(color);val output=ByteArray(128);val n=deflater.deflate(output,0,output.size,java.util.zip.Deflater.SYNC_FLUSH);parts+=output.copyOf(n)
        } } finally {deflater.end()}
        val data=init()+parts.flatMap { rect(2,1,16,RfbProtocol.be32(it.size)+it).toList() }.toByteArray();var at=0;val frames=mutableListOf<IntArray>()
        RfbProtocol({n->if(at+n>data.size)throw EOFException();data.copyOfRange(at,at+n).also{at+=n}},{},{_,_->},{_,_,p->frames+=p},{_,_,_,_->fail()}).use {
            try{it.run()}catch(_:EOFException){}
        }
        assertEquals(2,frames.size);assertEquals(0xffff0000.toInt(),frames.first()[0]);assertEquals(0xff00ff00.toInt(),frames.last()[0])
    }

}
