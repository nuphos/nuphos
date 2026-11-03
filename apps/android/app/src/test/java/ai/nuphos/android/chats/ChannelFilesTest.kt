package ai.nuphos.android.chats

import ai.nuphos.android.data.TransferDownloadFile
import ai.nuphos.android.ui.chats.PostFiles
import org.junit.Assert.*
import org.junit.Test

class ChannelFilesTest {
    private fun file(id: String, name: String, type: String? = null) = TransferDownloadFile(id, name, "ready", type)

    @Test fun groupsShareOneGridInPostingOrderAndOtherFilesFollow() {
        val loaded = mapOf(
            "g1" to listOf(file("a", "one.png"), file("b", "clip.mp4", "video/mp4")),
            "g2" to listOf(file("c", "report.pdf", "application/pdf"), file("d", "two.jpg")),
        )
        val files = PostFiles.of(listOf("g1", "g2"), loaded)
        assertEquals(listOf("g1/a", "g1/b", "g2/d"), files.media.map { it.key })
        assertEquals(listOf("g2/c"), files.others.map { it.key })
        assertEquals("The pager pages across every group's images, not videos", listOf("g1/a", "g2/d"), files.images.map { it.key })
        assertNull(files.lone)
    }

    @Test fun aGroupThatCannotBeReadDropsOutAndALoneImageShowsWhole() {
        val files = PostFiles.of(listOf("gone", "fine"), mapOf("fine" to listOf(file("x", "six.png"), file("y", "notes.txt"))))
        assertEquals("fine/x", files.lone?.key)
        assertEquals(listOf("fine/y"), files.others.map { it.key })
        assertNull("A lone video is still a tile", PostFiles.of(listOf("v"), mapOf("v" to listOf(file("v", "clip.mov")))).lone)
        assertTrue(PostFiles.of(listOf("a", "b"), emptyMap()).media.isEmpty())
    }

    @Test fun videosAreKnownByTypeOrName() {
        assertTrue(file("1", "x.bin", "video/quicktime").isVideo)
        assertTrue(file("2", "clip.webm").isVideo)
        assertFalse(file("3", "clip.png").isVideo)
        assertFalse(file("4", "movie.mp4", "application/octet-stream").isVideo)
    }
}
