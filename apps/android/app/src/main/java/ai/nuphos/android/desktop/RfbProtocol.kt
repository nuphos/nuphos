package ai.nuphos.android.desktop

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.zip.Inflater

/** The authenticated relay carries RFB 3.8, not a second computer-account sign-in. */
internal class RfbProtocol(
    private val read: suspend (Int) -> ByteArray,
    private val send: (ByteArray) -> Unit,
    private val ready: (Int, Int) -> Unit,
    private val frame: (Int, Int, IntArray) -> Unit,
    private val video: (Int, Int, ByteArray, Int) -> Unit,
    private val waiting: (Boolean) -> Unit = {},
) : AutoCloseable {
    var width = 0; private set
    var height = 0; private set
    private var pixels = IntArray(0)
    private val inflater = Inflater()
    private suspend fun u8() = read(1)[0].toInt() and 255
    private suspend fun u16(): Int { val b = read(2); return ((b[0].toInt() and 255) shl 8) or (b[1].toInt() and 255) }
    private suspend fun i32(): Int { var v = 0; for (b in read(4)) v = (v shl 8) or (b.toInt() and 255); return v }
    private suspend fun length(limit: Int = MAX_BYTES): Int = i32().also { require(it in 0..limit) { "Desktop data exceeds the supported limit." } }
    private fun resize(w: Int, h: Int) {
        require(w in 1..8192 && h in 1..8192 && w.toLong() * h <= MAX_PIXELS) { "Desktop resolution is too large." }
        width = w; height = h; pixels = IntArray(0)
    }
    suspend fun run() {
        val version = String(read(12), Charsets.US_ASCII)
        require(version == "RFB 003.008\n" || version == "RFB 003.007\n") { "This computer needs a newer desktop server." }
        send("RFB 003.008\n".toByteArray())
        val count = u8()
        require(count > 0) { "The desktop server refused the connection." }
        require(read(count).contains(1.toByte())) { "Update Nuphos on this computer to open its desktop without an account password." }
        send(byteArrayOf(1))
        require(i32() == 0) { "The desktop server refused the connection." }
        send(byteArrayOf(1))
        val w = u16(); val h = u16(); resize(w, h)
        read(16); read(length(4096))
        send(byteArrayOf(0,0,0,0,32,24,0,1,0,(-1).toByte(),0,(-1).toByte(),0,(-1).toByte(),16,8,0,0,0,0))
        val encodings = listOf(50,16,1,0,-239,-232,-223,-224)
        send(byteArrayOf(2,0) + be16(encodings.size) + encodings.flatMap { be32(it).toList() }.toByteArray())
        ready(width, height); request(false)
        while (true) {
            waiting(true); val type=u8(); waiting(false)
            when (type) {
            0 -> { update(); request(true) }
            1 -> { read(3); read(u16() * 6) }
            2 -> Unit
            3 -> { read(3); read(length(1 shl 20)) } // Never apply a remote clipboard to the phone.
            else -> throw IOException("Unsupported desktop message.")
            }
        }
    }
    fun request(incremental: Boolean) { if (width > 0) send(byteArrayOf(3, if (incremental) 1 else 0) + be16(0) + be16(0) + be16(width) + be16(height)) }
    private fun inside(x: Int, y: Int, w: Int, h: Int) = w > 0 && h > 0 && x >= 0 && y >= 0 && x.toLong()+w <= width && y.toLong()+h <= height
    private suspend fun update() {
        read(1); val count = u16(); var painted = false
        for (index in 0 until count) {
            val x=u16(); val y=u16(); val w=u16(); val h=u16(); val encoding=i32()
            when (encoding) {
                -224 -> break
                -223 -> { resize(w,h); ready(w,h); continue }
                -232 -> continue
                -239 -> { require(w <= 256 && h <= 256); read(w*h*4 + ((w+7)/8)*h); continue }
            }
            require(inside(x,y,w,h)) { "Desktop rectangle is outside the screen." }
            if (encoding == 50) {
                require(x == 0 && y == 0 && w == width && h == height)
                val size=length(); val flags=i32(); video(w,h,read(size),flags); continue
            }
            if(pixels.isEmpty()) pixels=IntArray(width*height)
            val tile = when (encoding) {
                0 -> raw(read(w*h*4), w*h, 4)
                1 -> { val sx=u16(); val sy=u16(); require(inside(sx,sy,w,h)); IntArray(w*h) { p -> pixels[(sy+p/w)*width+sx+p%w] } }
                16 -> zrle(inflate(read(length()), ((w+63)/64)*((h+63)/64)*384+w*h*4),w,h)
                else -> throw IOException("Unsupported desktop encoding.")
            }
            for (row in 0 until h) tile.copyInto(pixels,(y+row)*width+x,row*w,(row+1)*w)
            painted = true
        }
        if (painted) frame(width,height,pixels.copyOf())
    }
    private fun inflate(data: ByteArray, limit: Int): ByteArray {
        require(inflater.needsInput()); inflater.setInput(data)
        val output=ByteArrayOutputStream(); val chunk=ByteArray(8192)
        while (!inflater.needsInput()) {
            val n=inflater.inflate(chunk)
            require(n > 0 || inflater.needsInput()) { "Invalid compressed desktop frame." }
            require(output.size().toLong()+n <= limit) { "Compressed desktop frame is too large." }
            output.write(chunk,0,n)
        }
        return output.toByteArray()
    }
    override fun close() { inflater.end() }
    companion object {
        const val MAX_BYTES=16 shl 20
        const val MAX_PIXELS=6_291_456L
        fun be16(n: Int)=byteArrayOf((n ushr 8).toByte(),n.toByte())
        fun be32(n: Int)=byteArrayOf((n ushr 24).toByte(),(n ushr 16).toByte(),(n ushr 8).toByte(),n.toByte())
        fun pointer(mask: Int,x: Int,y: Int): ByteArray { require(mask in 0..127 && x in 0..65535 && y in 0..65535); return byteArrayOf(5,mask.toByte())+be16(x)+be16(y) }
        fun key(code: Int,down: Boolean)=byteArrayOf(4,if(down)1 else 0,0,0)+be32(code)
        fun raw(bytes: ByteArray,count: Int,stride: Int)=IntArray(count) { i -> val p=i*stride; (0xff shl 24) or ((bytes[p+2].toInt() and 255) shl 16) or ((bytes[p+1].toInt() and 255) shl 8) or (bytes[p].toInt() and 255) }
        fun zrle(data: ByteArray,w: Int,h: Int): IntArray {
            var at=0
            fun byte(): Int { require(at<data.size) { "Truncated desktop tile." }; return data[at++].toInt() and 255 }
            fun color(): Int { val b=byte(); val g=byte(); val r=byte(); return (0xff shl 24) or (r shl 16) or (g shl 8) or b }
            fun run(): Int { var n=1; do { val part=byte(); n+=part } while(part==255); return n }
            val result=IntArray(w*h)
            for (ty in 0 until h step 64) for (tx in 0 until w step 64) {
                val tw=minOf(64,w-tx); val th=minOf(64,h-ty); val size=tw*th; val mode=byte(); val tile=IntArray(size)
                when {
                    mode==0 -> for(i in tile.indices) tile[i]=color()
                    mode==1 -> tile.fill(color())
                    mode in 2..16 -> {
                        val palette=IntArray(mode) { color() }; val bits=if(mode==2)1 else if(mode<=4)2 else 4
                        for(y in 0 until th) { var packed=0; var remaining=0
                            for(x in 0 until tw) { if(remaining==0) { packed=byte(); remaining=8 }; remaining-=bits
                                val n=(packed ushr remaining) and ((1 shl bits)-1); require(n<palette.size); tile[y*tw+x]=palette[n] }
                        }
                    }
                    mode==128 -> { var i=0; while(i<size) { val c=color(); val n=run(); require(n<=size-i); tile.fill(c,i,i+n); i+=n } }
                    mode in 130..255 -> {
                        val palette=IntArray(mode-128) { color() }; var i=0
                        while(i<size) { val index=byte(); val n=if(index and 128 != 0)run() else 1; val p=index and 127
                            require(p<palette.size && n<=size-i); tile.fill(palette[p],i,i+n); i+=n }
                    }
                    else -> throw IOException("Invalid desktop tile encoding.")
                }
                for(y in 0 until th) tile.copyInto(result,(ty+y)*w+tx,y*tw,(y+1)*tw)
            }
            require(at==data.size) { "Unexpected desktop tile data." }; return result
        }
    }
}
