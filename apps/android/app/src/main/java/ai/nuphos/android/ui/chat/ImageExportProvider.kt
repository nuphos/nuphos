package ai.nuphos.android.ui.chat

import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileNotFoundException

/** Expired shared copies cannot be reopened even before the next export prunes the cache. */
class ImageExportProvider : FileProvider() {
    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        val root = File(requireNotNull(context).cacheDir, "image-exports").canonicalFile
        val file = File(root, uri.lastPathSegment ?: throw FileNotFoundException()).canonicalFile
        if (mode != "r" || file.parentFile != root || !file.isFile ||
            System.currentTimeMillis() - file.lastModified() > 24 * 60 * 60 * 1000L) {
            throw FileNotFoundException("Image export expired or unavailable")
        }
        return super.openFile(uri, mode) ?: throw FileNotFoundException("Image export unavailable")
    }
}
