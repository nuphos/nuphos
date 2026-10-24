package ai.nuphos.android.data

import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/** Atomic file boundary shared by journal and authority publication; callers own IO dispatch and ordering. */
fun interface ShareDraftWriter {
    fun replace(target: File, bytes: ByteArray)
}

object AtomicShareDraftWriter : ShareDraftWriter {
    override fun replace(target: File, bytes: ByteArray) {
        val next = File(target.parentFile, target.name.removeSuffix(".json") + ".next")
        try {
            require(!Files.isSymbolicLink(target.toPath()) && !Files.isSymbolicLink(next.toPath()) && !next.isDirectory)
            FileOutputStream(next).use { it.write(bytes); it.fd.sync() }
            Files.move(next.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } finally { next.delete() }
    }
}
