package ai.nuphos.android.data

import ai.nuphos.android.model.ComposerAttachment
import ai.nuphos.android.session.ComposerDrafts
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import java.util.UUID
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/** App-private, no-backup journal. Payloads are immutable; publish metadata before deleting old copies. */
class ShareDraftStore(
    private val directory: File,
    private val discardLegacyText: (Set<ComposerDrafts.Key>) -> Boolean = { true },
    private val fileWriter: ShareDraftWriter = AtomicShareDraftWriter,
    private val now: () -> Long = System::currentTimeMillis,
) {
    companion object {
        const val RETENTION_MS = 7 * 24 * 60 * 60 * 1000L
        const val MAX_DRAFTS = 64
        const val MAX_RETAINED_FILES = 128
        const val MAX_TEXT_TOTAL = 1_000_000
        const val MAX_METADATA_BYTES = 8 * 1024 * 1024L
    }
    @Serializable data class Blob(val id: String, val file: String, val name: String, val mime: String, val size: Long, val image: Boolean)
    @Serializable data class Address(val account: String, val team: String, val session: String? = null) {
        fun key() = ComposerDrafts.Key(account, team, session?.let { ComposerDrafts.Destination.Chat(it) } ?: ComposerDrafts.Destination.NewChat)
        companion object {
            fun from(key: ComposerDrafts.Key) = Address(key.accountId, key.teamId, (key.destination as? ComposerDrafts.Destination.Chat)?.sessionId)
        }
    }
    @Serializable data class Draft(val address: Address, val text: String, val blobs: List<Blob>, val updated: Long)
    @Serializable data class Pending(val id: Long, val account: String?, val text: String, val blobs: List<Blob>, val updated: Long)
    @Serializable data class Snapshot(val version: Int = 1, val pending: Pending? = null, val drafts: List<Draft> = emptyList(), val epoch: String = "", val revision: Long = 0)
    @Serializable private data class Authority(val address: Address, val epoch: String, val revision: Long)
    private val authorities = File(directory, "authorities")
    private val guards = mutableMapOf<ComposerDrafts.Key, Authority>()
    private var unsafeAuthorities = false
    val assets = File(directory, "assets")
    private val metadata = File(directory, "state.json")
    private val json = Json { ignoreUnknownKeys = false; encodeDefaults = true }
    private var previous = Snapshot()
    private val erasedLegacy = mutableSetOf<ComposerDrafts.Key>()
    private fun discardLegacy(keys: Set<ComposerDrafts.Key>): Boolean = runCatching {
        discardLegacyText(keys).also { if (it) erasedLegacy.addAll(keys) }
    }.getOrDefault(false)
    @Synchronized internal fun takeErasedLegacy(): Set<ComposerDrafts.Key> = erasedLegacy.toSet().also { erasedLegacy.clear() }
    private val blobName = Regex("attachment-[A-Za-z0-9_-]+\\.upload")

    private fun checkedFile(blob: Blob): File {
        require(blobName.matches(blob.file))
        require(blob.id.length in 1..128 && blob.name.trim().length in 1..512)
        require(blob.mime.length in 1..255 && '\n' !in blob.mime && '\r' !in blob.mime)
        require(!blob.image || blob.mime == "image/jpeg")
        require(blob.size in 1..AttachmentTransfers.MAX_FILE_BYTES)
        val file = File(assets, blob.file)
        require(!Files.isSymbolicLink(assets.toPath()) && !Files.isSymbolicLink(file.toPath()))
        require(file.canonicalFile.parentFile == assets.canonicalFile && file.isFile && file.length() == blob.size)
        return file
    }
    private fun validate(snapshot: Snapshot) {
        require(snapshot.version == 1 && snapshot.drafts.size <= MAX_DRAFTS)
        require(snapshot.revision >= 0 && (snapshot.epoch.isEmpty() || UUID.fromString(snapshot.epoch).toString() == snapshot.epoch))
        val addresses = snapshot.drafts.map { it.address }
        require(addresses.distinct().size == addresses.size)
        fun identity(value: String) { require(value.isNotBlank() && value.length <= 256) }
        addresses.forEach { identity(it.account); identity(it.team); it.session?.let(::identity) }
        snapshot.pending?.let { require(it.id > 0); it.account?.let(::identity) }
        val batches = snapshot.drafts.map { it.blobs } + listOfNotNull(snapshot.pending?.blobs)
        val blobs = batches.flatten()
        require(blobs.size <= MAX_RETAINED_FILES && blobs.map { it.id }.distinct().size == blobs.size)
        require(blobs.map { it.file }.distinct().size == blobs.size)
        batches.forEach { require(it.size <= AttachmentTransfers.MAX_FILES) }
        require(blobs.sumOf { it.size } <= AttachmentTransfers.MAX_TOTAL_BYTES)
        blobs.forEach(::checkedFile)
        val texts = snapshot.drafts.map { it.text } + listOfNotNull(snapshot.pending?.text)
        require(texts.all { it.length <= IncomingShareIntents.MAX_TEXT } && texts.sumOf { it.length } <= MAX_TEXT_TOTAL)
        val times = snapshot.drafts.map { it.updated } + listOfNotNull(snapshot.pending?.updated)
        require(times.all { it in 1..now() + 60_000 })
    }
    private fun authorityName(address: Address) = MessageDigest.getInstance("SHA-256")
        .digest(json.encodeToString(address).toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) } + ".json"
    private fun atomicWrite(target: File, bytes: ByteArray) = fileWriter.replace(target, bytes)
    private fun ensureGuard(address: Address, epoch: String, revision: Long) {
        if (address.key() in guards) return
        require(!unsafeAuthorities && !Files.isSymbolicLink(authorities.toPath()))
        require(authorities.isDirectory || authorities.mkdirs())
        require(authorities.listFiles().orEmpty().size < 256) { "Too many pending draft cleanup records." }
        val guard = Authority(address, epoch, revision)
        val bytes = json.encodeToString(guard).toByteArray(Charsets.UTF_8)
        require(bytes.size <= 2048)
        atomicWrite(File(authorities, authorityName(address)), bytes)
        guards[address.key()] = guard
    }
    private fun readGuards() {
        guards.clear(); unsafeAuthorities = false
        if (Files.isSymbolicLink(directory.toPath()) || Files.isSymbolicLink(authorities.toPath())) {
            unsafeAuthorities = true; return
        }
        val files = authorities.listFiles().orEmpty()
        if (files.size > 256 || (authorities.exists() && !authorities.isDirectory)) { unsafeAuthorities = true; return }
        for (file in files) {
            if (file.name.matches(Regex("[0-9a-f]{64}\\.next"))) { file.delete(); continue }
            runCatching {
                require(!Files.isSymbolicLink(file.toPath()) && file.isFile && file.length() in 1..2048)
                val guard = json.decodeFromString<Authority>(file.readText())
                require(file.name == authorityName(guard.address))
                require(listOfNotNull(guard.address.account, guard.address.team, guard.address.session).all { it.isNotBlank() && it.length <= 256 })
                require(guard.revision >= 0 && (guard.epoch.isEmpty() || UUID.fromString(guard.epoch).toString() == guard.epoch))
                guards[guard.address.key()] = guard
            }.onFailure { unsafeAuthorities = true } // Unknown identity: suppress fallback, never erase unrelated preferences.
        }
    }
    private fun retireGuard(key: ComposerDrafts.Key) {
        val guard = guards[key] ?: return
        val file = File(authorities, authorityName(guard.address))
        if (!file.exists() || file.delete()) guards.remove(key)
    }
    private fun isPrepared(guard: Authority) = guard.epoch == previous.epoch && guard.revision > previous.revision &&
        previous.drafts.none { it.address == guard.address }
    @Synchronized internal fun legacyKeys() = guards.filterValues { !isPrepared(it) }.keys.toSet()
    @Synchronized internal fun suppressesAllLegacy() = unsafeAuthorities
    @Synchronized fun suppressesLegacyText(key: ComposerDrafts.Key) = unsafeAuthorities || guards[key]?.let { !isPrepared(it) } == true
    @Synchronized fun load(): Snapshot {
        readGuards()
        var validRoot = false
        val loaded = runCatching {
            require(!Files.isSymbolicLink(directory.toPath()) && !Files.isSymbolicLink(metadata.toPath()))
            if (!metadata.exists()) Snapshot() else {
                require(metadata.length() in 1..MAX_METADATA_BYTES)
                json.decodeFromString<Snapshot>(metadata.readText()).also { validate(it); validRoot = true }
            }
        }.getOrElse {
            // Independent authority records survive corrupt metadata or missing payloads.
            if (!Files.isSymbolicLink(directory.toPath())) metadata.delete()
            Snapshot()
        }
        previous = loaded
        if (validRoot) guards.values.toList().filter {
            it.epoch == loaded.epoch && it.revision > loaded.revision && loaded.drafts.none { draft -> draft.address == it.address }
        }.forEach { retireGuard(it.address.key()) } // Prepared but never published: preserve the ordinary draft.
        val cutoff = now() - RETENTION_MS
        val expired = loaded.drafts.filter { it.updated <= cutoff }
        val clearedText = expired.isEmpty() || discardLegacy(expired.map { it.address.key() }.toSet())
        val current = loaded.copy(pending = loaded.pending?.takeIf { it.updated > cutoff },
            drafts = loaded.drafts.mapNotNull {
                if (it.updated > cutoff) it
                else if (clearedText) null
                else it.copy(text = "", blobs = emptyList())
            })
        // Legacy journals are upgraded before they may be unlinked by a later failed deletion.
        runCatching { loaded.drafts.forEach { ensureGuard(it.address, loaded.epoch, loaded.revision) } }.onFailure { unsafeAuthorities = true }
        if (current != loaded) runCatching { commit(current) }.onFailure { metadata.delete() }
        val active = current.drafts.map { it.address.key() }.toSet()
        guards.keys.toList().filter { it !in active && guards[it]?.let(::isPrepared) != true }.forEach { key ->
            if (discardLegacy(setOf(key))) retireGuard(key)
        }
        cleanOrphans(current)
        return current
    }
    @Synchronized fun commit(snapshot: Snapshot, keepRemoved: Boolean = false) {
        require(!Files.isSymbolicLink(directory.toPath()) && !Files.isSymbolicLink(assets.toPath()))
        validate(snapshot)
        require(directory.isDirectory || directory.mkdirs()) { "Cannot create share draft storage." }
        if (previous.epoch.isEmpty() || !metadata.exists()) {
            // A valid older revision distinguishes an uncommitted first import from a lost committed root.
            previous.drafts.forEach { ensureGuard(it.address, "", 0) }
            val baseline = if (previous.epoch.isEmpty()) previous.copy(epoch = UUID.randomUUID().toString(), revision = 0) else previous
            atomicWrite(metadata, json.encodeToString(baseline).toByteArray(Charsets.UTF_8))
            previous = baseline
        }
        // Remove guards from failed live publications before advancing the high-water mark.
        guards.values.toList().filter(::isPrepared).forEach {
            retireGuard(it.address.key())
            require(it.address.key() !in guards) { "Cannot retire an unpublished draft marker." }
        }
        val saved = snapshot.copy(epoch = previous.epoch, revision = Math.addExact(previous.revision, 1))
        saved.drafts.forEach { ensureGuard(it.address, saved.epoch, saved.revision) }
        val bytes = json.encodeToString(saved).toByteArray(Charsets.UTF_8)
        require(bytes.size <= MAX_METADATA_BYTES)
        atomicWrite(metadata, bytes)
        val currentNames = (saved.drafts.flatMap { it.blobs } + saved.pending?.blobs.orEmpty()).map { it.file }.toSet()
        if (!keepRemoved) (previous.drafts.flatMap { it.blobs } + previous.pending?.blobs.orEmpty())
            .filter { it.file !in currentNames }.forEach { runCatching { File(assets, it.file).delete() } }
        previous = saved
    }
    @Synchronized fun discardJournal() {
        require(!Files.isSymbolicLink(directory.toPath()))
        previous.drafts.forEach { ensureGuard(it.address, previous.epoch, previous.revision) }
        // If a prepared marker could not be retired, this root is the proof that it never committed.
        require(guards.values.none(::isPrepared)) { "Cannot discard metadata with an unpublished draft marker." }
        require(!metadata.exists() || metadata.delete()) { "Cannot remove saved share metadata." }
        // Keep both the independent guards and revision high-water mark. Never retire guards during a live lease.
        previous = previous.copy(pending = null, drafts = emptyList())
    }
    private fun cleanOrphans(snapshot: Snapshot) {
        if (Files.isSymbolicLink(directory.toPath())) { directory.delete(); return }
        if (Files.isSymbolicLink(assets.toPath())) { assets.delete(); return }
        val retained = (snapshot.drafts.flatMap { it.blobs } + snapshot.pending?.blobs.orEmpty()).map { it.file }.toSet()
        // Only enumerate our directory. Never follow metadata paths or symlinks when deleting.
        assets.listFiles()?.filter { it.name !in retained }?.forEach { if (!it.isDirectory || Files.isSymbolicLink(it.toPath())) it.delete() }
        File(directory, "state.next").delete()
    }
    fun eraseLegacyText(keys: Set<ComposerDrafts.Key>) {
        // The journal tombstone is already committed. On failure, expiry retries before retiring it.
        discardLegacy(keys)
    }
    fun usedBytes(): Long {
        if (Files.isSymbolicLink(directory.toPath()) || Files.isSymbolicLink(assets.toPath())) return AttachmentTransfers.MAX_TOTAL_BYTES
        return assets.listFiles().orEmpty().fold(0L) { total, file ->
            if (Files.isSymbolicLink(file.toPath()) || !file.isFile) AttachmentTransfers.MAX_TOTAL_BYTES
            else minOf(AttachmentTransfers.MAX_TOTAL_BYTES, total + minOf(file.length(), AttachmentTransfers.MAX_TOTAL_BYTES))
        }
    }
    fun restore(blobs: List<Blob>): List<ComposerAttachment> = blobs.map {
        ComposerAttachment(it.id, it.name, ComposerAttachment.Kind.RetainedFile(OwnedAttachmentFile.restore(checkedFile(it), it.size), it.mime, it.image))
    }
    fun describe(attachments: List<ComposerAttachment>): List<Blob> = attachments.map {
        val kind = requireNotNull(it.kind as? ComposerAttachment.Kind.RetainedFile)
        require(kind.source.file.canonicalFile.parentFile == assets.canonicalFile)
        Blob(it.id, kind.source.file.name, it.name, kind.mime, kind.source.size, kind.image).also(::checkedFile)
    }
    /** Large payload IO is performed by the importer on Dispatchers.IO, before journal publication. */
    fun retain(attachments: List<ComposerAttachment>, check: () -> Unit): List<ComposerAttachment> {
        require(!Files.isSymbolicLink(directory.toPath()) && !Files.isSymbolicLink(assets.toPath()))
        require(attachments.size <= AttachmentTransfers.MAX_FILES)
        val staged = mutableListOf<ComposerAttachment>()
        val copies = mutableListOf<ComposerAttachment>()
        try {
            for (attachment in attachments) {
                check()
                val retained = attachment.kind as? ComposerAttachment.Kind.RetainedFile
                if (retained != null && retained.source.file.canonicalFile.parentFile == assets.canonicalFile) {
                    checkedFile(describe(listOf(attachment)).single())
                    staged += attachment
                    continue
                }
                val mime = when (val kind = attachment.kind) {
                    is ComposerAttachment.Kind.Image -> "image/jpeg"
                    is ComposerAttachment.Kind.File -> kind.mime
                    is ComposerAttachment.Kind.RetainedFile -> kind.mime
                }
                require(assets.listFiles().orEmpty().size < MAX_RETAINED_FILES) { "Too many saved attachment files." }
                val remaining = minOf(AttachmentTransfers.MAX_FILE_BYTES, AttachmentTransfers.MAX_TOTAL_BYTES - usedBytes())
                val input = when (val kind = attachment.kind) {
                    is ComposerAttachment.Kind.Image -> kind.jpeg.inputStream()
                    is ComposerAttachment.Kind.File -> kind.bytes.inputStream()
                    is ComposerAttachment.Kind.RetainedFile -> kind.source.open()
                }
                val source = input.use { OwnedAttachmentFile.copy(assets, it, remaining, check) }
                val copy = attachment.copy(kind = ComposerAttachment.Kind.RetainedFile(source, mime, attachment.isImage))
                staged += copy
                copies += copy
            }
            return staged
        } catch (failure: Throwable) {
            copies.forEach { it.releaseOwnedCopy() }
            throw failure
        }
    }
}
