package ai.nuphos.android.ui.chats

import android.media.MediaDataSource
import android.media.MediaMetadataRetriever
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import ai.nuphos.android.data.TransferDownloadFile
import ai.nuphos.android.data.TransferDownloads
import java.io.File

/**
 * A remote video read in blocks with Range requests, for a first frame: only what the frame needs is
 * fetched, never the whole file. A block that can't be read ends the read, so the frame is just missing.
 */
internal class RangedVideo(
    private val downloads: TransferDownloads,
    private val file: TransferDownloadFile,
    private val allowed: () -> Boolean,
) : MediaDataSource() {
    private val blocks = object : LinkedHashMap<Long, ByteArray>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Long, ByteArray>?) = size > 8
    }
    private fun block(index: Long): ByteArray = blocks.getOrPut(index) { downloads.range(file, index * BLOCK, BLOCK, allowed) }

    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
        if (size == 0) return 0
        val bytes = try { block(position / BLOCK) } catch (_: Exception) { return -1 }
        val at = (position % BLOCK).toInt()
        if (at >= bytes.size) return -1
        val count = minOf(size, bytes.size - at)
        System.arraycopy(bytes, at, buffer, offset, count)
        return count
    }
    override fun getSize(): Long = file.size ?: -1
    override fun close() = blocks.clear()

    companion object { const val BLOCK = 256 * 1024 }
}

internal object VideoFrames {
    /** The video's first frame, at most [edge] pixels on a side, from a local copy when there is one. Blocking. */
    fun first(local: File?, remote: () -> RangedVideo, edge: Int): ImageBitmap? {
        val retriever = MediaMetadataRetriever()
        return try {
            if (local != null) retriever.setDataSource(local.absolutePath) else retriever.setDataSource(remote())
            retriever.getScaledFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, edge, edge)?.asImageBitmap()
        } catch (_: Exception) {
            null
        } finally {
            runCatching { retriever.release() }
        }
    }
}
