package ai.nuphos.android.session

import ai.nuphos.android.data.ShareDraftStore
import ai.nuphos.android.model.ComposerAttachment
import ai.nuphos.android.session.IncomingShares.Pending
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Main-thread mailbox. The journal is authoritative for shared text + attachments as one transaction. */
internal class IncomingShareMailbox(private val disk: ShareDraftStore? = null, private val now: () -> Long = System::currentTimeMillis) {
    private var journal = disk?.load() ?: ShareDraftStore.Snapshot()
    private var account: String? = null
    private val delivered = mutableMapOf<ComposerDrafts.Key, List<ComposerAttachment>>()
    private val handedOff = mutableMapOf<String, ai.nuphos.android.data.OwnedAttachmentFile>()
    private fun source(file: ComposerAttachment) = (file.kind as? ComposerAttachment.Kind.RetainedFile)?.source
    private var sequence = maxOf(now(), journal.pending?.id ?: 0L)
    private val mutable = MutableStateFlow(journal.pending?.let {
        // A choice interrupted before consumption must be explicitly selected and authorized again.
        Pending(it.id, it.account, it.text, disk?.restore(it.blobs).orEmpty(), loading = false)
    })
    val state = mutable.asStateFlow()
    private fun publish(next: ShareDraftStore.Snapshot, keepRemoved: Boolean = false) {
        disk?.commit(next, keepRemoved)
        journal = next
    }
    private fun deleteTransaction(next: ShareDraftStore.Snapshot, keepRemoved: Boolean = false) {
        try { publish(next, keepRemoved) }
        catch (_: Exception) {
            // A cancellation/sign-out must not reappear after a full-disk write failure.
            disk?.discardJournal()
            journal = ShareDraftStore.Snapshot()
        }
    }
    fun hasDraft(key: ComposerDrafts.Key) = journal.drafts.any { it.address.key() == key } || disk?.suppressesLegacyText(key) == true
    fun checkWritable(key: ComposerDrafts.Key) { if (hasDraft(key)) disk?.commit(journal, keepRemoved = true) }
    fun attachments(key: ComposerDrafts.Key) = if (account == key.accountId || disk == null) delivered[key].orEmpty() else emptyList()
    fun owns(key: ComposerDrafts.Key, id: String) = attachments(key).any { it.id == id }
    fun text(key: ComposerDrafts.Key): String? = journal.drafts.firstOrNull { it.address.key() == key && account == key.accountId }?.text ?: if (disk?.suppressesLegacyText(key) == true) "" else null
    fun writeText(key: ComposerDrafts.Key, value: String) {
        if (account != key.accountId || text(key) == null) return
        val draft = journal.drafts.firstOrNull { it.address.key() == key }
            ?.copy(text = value, updated = now())
            ?: ShareDraftStore.Draft(ShareDraftStore.Address.from(key), value, emptyList(), now())
        publish(journal.copy(drafts = journal.drafts.filterNot { it.address.key() == key } + draft))
    }
    fun forgetAttachment(key: ComposerDrafts.Key, id: String) {
        if (!owns(key, id)) return
        deleteTransaction(journal.copy(drafts = journal.drafts.map {
            if (it.address.key() == key) it.copy(blobs = it.blobs.filterNot { blob -> blob.id == id }, updated = now()) else it
        }))
        val remaining = attachments(key).filterNot { it.id == id }
        if (remaining.isEmpty()) delivered.remove(key) else delivered[key] = remaining
    }
    fun sent(key: ComposerDrafts.Key) {
        if (!hasDraft(key)) return
        // Empty text is an explicit tombstone against an older asynchronous text-preference write.
        deleteTransaction(journal.copy(drafts = journal.drafts.map {
            if (it.address.key() == key) it.copy(text = "", blobs = emptyList(), updated = now()) else it
        }), keepRemoved = true)
        disk?.eraseLegacyText(setOf(key))
        handoff(attachments(key))
        delivered.remove(key) // user initiated submission now owns the files; never auto-resume it
    }
    fun drop(key: ComposerDrafts.Key) {
        if (!hasDraft(key)) return
        deleteTransaction(journal.copy(drafts = journal.drafts.map { if (it.address.key() == key) it.copy(text = "", blobs = emptyList(), updated = now()) else it }))
        disk?.eraseLegacyText(setOf(key))
        delivered.remove(key)?.forEach { it.releaseOwnedCopy() }
    }
    fun pruneTeams(allowed: Set<String>, accountId: String? = account) {
        val removed = journal.drafts.filter { it.address.account == accountId && it.address.team !in allowed && (it.text.isNotEmpty() || it.blobs.isNotEmpty()) }.map { it.address.key() }
        if (removed.isNotEmpty()) {
            deleteTransaction(journal.copy(drafts = journal.drafts.map { if (it.address.key() in removed) it.copy(text = "", blobs = emptyList(), updated = now()) else it }))
            disk?.eraseLegacyText(removed.toSet())
            removed.forEach { delivered.remove(it)?.forEach { file -> file.releaseOwnedCopy() } }
        }
    }
    fun begin(accountId: String?): Long? {
        if (mutable.value != null) return null
        val id = ++sequence
        mutable.value = Pending(id, accountId)
        return id
    }
    fun remainingBytes(): Long = ai.nuphos.android.data.AttachmentTransfers.MAX_TOTAL_BYTES -
        (disk?.usedBytes() ?: journal.drafts.flatMap { it.blobs }.sumOf { it.size })
    fun prepare(attachments: List<ComposerAttachment>, check: () -> Unit = {}) = disk?.retain(attachments, check) ?: attachments
    fun loaded(id: Long, text: String, attachments: List<ComposerAttachment>): Boolean {
        val current = mutable.value
        if (current?.id != id) { attachments.forEach { it.releaseOwnedCopy() }; return false }
        val retainedBytes = delivered.values.flatten().sumOf { it.sizeBytes }
        if (retainedBytes + attachments.sumOf { it.sizeBytes } > ai.nuphos.android.data.AttachmentTransfers.MAX_TOTAL_BYTES) {
            attachments.forEach { it.releaseOwnedCopy() }
            failed(id, "Shared attachment drafts exceed 500 MiB. Send or remove an existing draft first.")
            return false
        }
        publish(journal.copy(pending = ShareDraftStore.Pending(id, current.accountId, text, disk?.describe(attachments).orEmpty(), now())))
        mutable.value = current.copy(text = text, attachments = attachments, loading = false)
        return true
    }
    fun failed(id: Long, error: String) {
        val current = mutable.value ?: return
        if (current.id == id) mutable.value = current.copy(loading = false, error = error, destination = null)
    }
    fun bindAccount(accountId: String) {
        val changed = journal.drafts.any { it.address.account != accountId } ||
            journal.pending?.account?.let { it != accountId } == true ||
            mutable.value?.accountId?.let { it != accountId } == true
        if (changed) identityReset()
        account = accountId
        if (delivered.isEmpty()) journal.drafts.filter { it.address.account == accountId }.forEach {
            delivered[it.address.key()] = disk?.restore(it.blobs).orEmpty()
        }
        val current = mutable.value ?: return
        if (current.accountId == null) {
            if (journal.pending != null) publish(journal.copy(pending = journal.pending!!.copy(account = accountId)))
            mutable.value = current.copy(accountId = accountId)
        } else if (current.accountId != accountId) cancel()
    }
    fun choose(id: Long, key: ComposerDrafts.Key): Boolean {
        val current = mutable.value ?: return false
        if (current.id != id || current.loading || current.error != null || current.accountId != key.accountId) return false
        mutable.value = current.copy(destination = key)
        return true
    }
    fun consumed(id: Long, key: ComposerDrafts.Key, mergedText: String = "", combined: List<ComposerAttachment>? = null): Boolean {
        val current = mutable.value ?: return false
        if (current.id != id || current.destination != key) return false
        val files = combined ?: (attachments(key) + current.attachments).distinctBy { it.id }
        val draft = ShareDraftStore.Draft(ShareDraftStore.Address.from(key), mergedText, disk?.describe(files).orEmpty(), now())
        publish(journal.copy(pending = null, drafts = journal.drafts.filterNot { it.address.key() == key } + draft))
        delivered[key] = files
        mutable.value = null
        return true
    }
    fun cancel() {
        val current = mutable.value
        deleteTransaction(journal.copy(pending = null))
        mutable.value = null
        current?.attachments?.forEach { it.releaseOwnedCopy() }
    }
    fun identityReset() {
        // Initial sign-in can claim a newly captured, unowned share. Bound content never survives replacement.
        val unowned = mutable.value?.takeIf { it.accountId == null }
        deleteTransaction(ShareDraftStore.Snapshot(pending = journal.pending?.takeIf { it.account == null }))
        delivered.values.flatten().forEach { it.releaseOwnedCopy() }
        delivered.clear()
        if (unowned == null) mutable.value?.attachments?.forEach { it.releaseOwnedCopy() }
        mutable.value = unowned
        account = null
    }
    fun projection() = IncomingShareView(account, journal.drafts.associate { it.address.key() to it.text },
        delivered.mapValues { it.value.toList() }, disk?.legacyKeys().orEmpty(), disk?.suppressesAllLegacy() == true)
    fun handoff(files: List<ComposerAttachment>) {
        handedOff.entries.removeAll { !it.value.exists }
        files.forEach { file -> source(file)?.let { handedOff[it.file.absolutePath] = it } }
    }
    fun releaseUnowned(files: List<ComposerAttachment>) {
        handedOff.entries.removeAll { !it.value.exists }
        val owned = (journal.drafts.flatMap { it.blobs } + journal.pending?.blobs.orEmpty())
            .mapNotNull { blob -> disk?.assets?.let { java.io.File(it, blob.file).absolutePath } }.toSet() +
            (delivered.values.flatten() + mutable.value?.attachments.orEmpty()).mapNotNull { source(it)?.file?.absolutePath } + handedOff.keys
        // A retained replacement preserves the attachment ID but owns a different file than the old picker copy.
        files.filter { source(it)?.file?.absolutePath !in owned }.forEach { it.releaseOwnedCopy() }
    }

}
