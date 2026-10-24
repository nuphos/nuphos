package ai.nuphos.android.session

import ai.nuphos.android.data.ShareDraftStore
import ai.nuphos.android.model.ComposerAttachment
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

internal data class IncomingShareView(
    val account: String? = null,
    val texts: Map<ComposerDrafts.Key, String> = emptyMap(),
    val files: Map<ComposerDrafts.Key, List<ComposerAttachment>> = emptyMap(),
    val legacy: Set<ComposerDrafts.Key> = emptySet(),
    val suppressAll: Boolean = false,
)

/** All journal/guard/file operations belong to one IO actor. UI getters only read immutable projections. */
class IncomingShares(
    disk: ShareDraftStore? = null,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val uiDispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
    beforeLoad: () -> Unit = {},
    private val onLegacyErased: (Set<ComposerDrafts.Key>) -> Unit = {},
    now: () -> Long = System::currentTimeMillis,
) {
    data class Pending(
        val id: Long,
        val accountId: String?,
        val text: String = "",
        val attachments: List<ComposerAttachment> = emptyList(),
        val loading: Boolean = true,
        val error: String? = null,
        val destination: ComposerDrafts.Key? = null,
    )
    private data class Edit(val key: ComposerDrafts.Key, val text: String, val identity: Long, val keyVersion: Long)
    private interface Work { suspend fun run(box: IncomingShareMailbox); fun fail(error: Throwable) {} }
    private class EditWork(var edit: Edit, var started: Boolean = false, val execute: suspend (Edit, IncomingShareMailbox) -> Unit) : Work {
        override suspend fun run(box: IncomingShareMailbox) = execute(edit, box)
    }
    private val queue = Channel<Work>(Channel.UNLIMITED)
    private val queueLock = Any()
    private var tailEdit: EditWork? = null
    private val scope = CoroutineScope(SupervisorJob() + ioDispatcher)
    private val uiScope = CoroutineScope(SupervisorJob() + uiDispatcher)
    private val identity = AtomicLong()
    private val keySequence = AtomicLong()
    private val importStarting = AtomicBoolean()
    private val cancelQueued = AtomicBoolean()
    private val diskForStaging = disk
    private val keyVersions = ConcurrentHashMap<ComposerDrafts.Key, Long>()
    private val optimistic = ConcurrentHashMap<ComposerDrafts.Key, Edit>()
    private val clearing = ConcurrentHashMap<ComposerDrafts.Key, Long>()
    private var actorIdentity = 0L // IO actor only
    private var identityFailure: Throwable? = null
    private var cancelFailure: Throwable? = null
    private var cancelFailureId: Long? = null
    private fun retireObsoleteCancel(box: IncomingShareMailbox) {
        if (cancelFailure != null && box.state.value?.id != cancelFailureId) { cancelFailure = null; cancelFailureId = null }
    }
    @Volatile private var view = IncomingShareView()
    @Volatile private var viewIdentity = -1L
    private val mutable = MutableStateFlow<Pending?>(null)
    val state = mutable.asStateFlow()
    private val mutableReady = MutableStateFlow(false)
    val ready = mutableReady.asStateFlow()
    private val mutableRevision = MutableStateFlow(0L)
    val revision = mutableRevision.asStateFlow()
    private val mutableError = MutableStateFlow<String?>(null)
    val persistenceError = mutableError.asStateFlow()

    init {
        scope.launch {
            var failure: Throwable? = null
            val box = try {
                beforeLoad()
                IncomingShareMailbox(disk, now).also { publish(it); withContext(uiDispatcher) { mutableReady.value = true } }
            } catch (error: Throwable) {
                failure = error
                reportFailure()
                null
            }
            for (work in queue) {
                if (work is EditWork) synchronized(queueLock) {
                    work.started = true
                    if (tailEdit === work) tailEdit = null
                }
                if (box == null) { work.fail(failure ?: IllegalStateException("Share storage is unavailable.")); continue }
                try { work.run(box) }
                catch (_: Throwable) { reportFailure() }
            }
        }
    }
    private suspend fun reportFailure() = withContext(uiDispatcher) {
        mutableError.value = "Could not save this draft. Check storage and try again before closing the app."
    }
    private suspend fun publish(box: IncomingShareMailbox, afterProjection: () -> Unit = {}) {
        val next = box.projection()
        val pending = box.state.value
        val epoch = actorIdentity
        val erased = diskForStaging?.takeErasedLegacy().orEmpty()
        withContext(uiDispatcher) {
            if (erased.isNotEmpty()) onLegacyErased(erased)
            view = next
            viewIdentity = epoch
            afterProjection()
            mutable.value = pending.takeIf { epoch == identity.get() || it?.accountId == null }
            mutableRevision.value++
        }
    }
    private fun <T> enqueue(block: suspend (IncomingShareMailbox) -> T): Deferred<T> {
        val result = CompletableDeferred<T>()
        val work = object : Work {
            override fun fail(error: Throwable) { result.completeExceptionally(error) }
            override suspend fun run(box: IncomingShareMailbox) {
                try {
                    val value = block(box)
                    publish(box)
                    result.complete(value)
                } catch (failure: Throwable) {
                    runCatching { publish(box) }
                    result.completeExceptionally(failure)
                    reportFailure()
                }
            }
        }
        synchronized(queueLock) {
            tailEdit = null // Never conflate text across a consumption/deletion/identity barrier.
            check(queue.trySend(work).isSuccess)
        }
        return result
    }
    private fun current() = viewIdentity == identity.get()
    fun isBound(account: String) = ready.value && current() && view.account == account
    fun hasDraft(key: ComposerDrafts.Key) = key in view.texts || key in view.legacy || view.suppressAll
    fun attachments(key: ComposerDrafts.Key): List<ComposerAttachment> =
        if (current() && view.account == key.accountId && !clearing.containsKey(key)) view.files[key].orEmpty() else emptyList()
    fun owns(key: ComposerDrafts.Key, id: String) = attachments(key).any { it.id == id }
    fun text(key: ComposerDrafts.Key): String? {
        if (clearing.containsKey(key)) return ""
        if (isBound(key.accountId)) {
            optimistic[key]?.takeIf { it.identity == identity.get() && it.keyVersion == keyVersions[key].orZero() }?.let { return it.text }
            view.texts[key]?.let { return it }
        }
        return if (key in view.legacy || view.suppressAll || !current()) "" else null
    }
    private fun Long?.orZero() = this ?: 0L
    private fun invalidate(key: ComposerDrafts.Key): Long {
        val version = keySequence.incrementAndGet()
        keyVersions[key] = version
        optimistic.remove(key)
        clearing[key] = version
        return version
    }
    private fun finishClear(key: ComposerDrafts.Key, version: Long) { clearing.remove(key, version) }

    /** No disk access, serialization or flush occurs in the input callback. At most one trailing edit is queued. */
    fun writeText(key: ComposerDrafts.Key, value: String) {
        val epoch = viewIdentity
        val version = keyVersions[key].orZero()
        if (!isBound(key.accountId) || !hasDraft(key) || clearing.containsKey(key)) return
        require(value.length <= ai.nuphos.android.data.IncomingShareIntents.MAX_TEXT)
        val edit = Edit(key, value, epoch, version)
        optimistic[key] = edit
        synchronized(queueLock) {
            val tail = tailEdit
            if (tail != null && !tail.started && tail.edit.key == key) tail.edit = edit
            else {
                val next = EditWork(edit) { captured, box ->
                    if (captured.identity == identity.get() && captured.identity == actorIdentity && captured.keyVersion == keyVersions[captured.key].orZero()) {
                        try {
                            box.writeText(captured.key, captured.text)
                            publish(box)
                            withContext(uiDispatcher) {
                                optimistic.remove(captured.key, captured)
                                if (optimistic.isEmpty() && clearing.isEmpty()) mutableError.value = null
                                mutableRevision.value++
                            }
                        } finally { publish(box) }
                    } else optimistic.remove(captured.key, captured)
                }
                tailEdit = next
                check(queue.trySend(next).isSuccess)
            }
        }
    }
    internal fun close() { queue.close(); scope.cancel(); uiScope.cancel() }
    suspend fun awaitIdle() { enqueue { identityFailure?.let { throw it }; cancelFailure?.let { throw it } }.await() }
    suspend fun checkWritable(key: ComposerDrafts.Key) = enqueue { box ->
        check(actorIdentity == identity.get()) { "Identity cleanup is pending." }
        val retry = optimistic[key]?.takeIf { it.identity == identity.get() && it.keyVersion == keyVersions[key].orZero() }
        if (retry != null) box.writeText(key, retry.text)
        box.checkWritable(key)
        publish(box)
        withContext(uiDispatcher) {
            if (retry != null) optimistic.remove(key, retry)
            if (optimistic.isEmpty() && clearing.isEmpty()) mutableError.value = null
        }
    }.await()
    suspend fun begin(accountId: String?): Long? {
        if (state.value != null || !importStarting.compareAndSet(false, true)) return null
        val epoch = identity.get()
        return try { enqueue { if (epoch == identity.get() && actorIdentity == epoch) it.begin(accountId) else null }.await() }
        finally { importStarting.set(false) }
    }
    suspend fun remainingBytes() = enqueue { it.remainingBytes() }.await()
    // Payload staging callers already run on Dispatchers.IO, independently of the metadata actor.
    fun prepare(attachments: List<ComposerAttachment>, check: () -> Unit = {}): List<ComposerAttachment> =
        diskForStaging?.retain(attachments, check) ?: attachments
    suspend fun loaded(id: Long, text: String, files: List<ComposerAttachment>): Boolean {
        val epoch = identity.get()
        return enqueue {
            if (epoch == identity.get() && actorIdentity == epoch) it.loaded(id, text, files)
            else { files.forEach { file -> file.releaseOwnedCopy() }; false }
        }.await()
    }
    fun failed(id: Long, error: String) { enqueue { it.failed(id, error) } }
    suspend fun bindAccount(accountId: String) {
        val epoch = identity.get()
        try {
            enqueue { box ->
                if (epoch == identity.get()) {
                    retireObsoleteCancel(box)
                    if (cancelFailure != null) { box.cancel(); cancelFailure = null; cancelFailureId = null }
                    if (actorIdentity != epoch || identityFailure != null) {
                        box.identityReset(); actorIdentity = epoch; identityFailure = null
                    }
                    box.bindAccount(accountId)
                }
            }.await()
        } catch (failure: Throwable) {
            if (failure is CancellationException) throw failure
            // Storage errors are exposed through persistenceError; keep the composer gated rather than crashing Root.
        }
    }
    suspend fun choose(id: Long, key: ComposerDrafts.Key): Boolean {
        val epoch = identity.get()
        return enqueue { epoch == identity.get() && actorIdentity == epoch && it.choose(id, key) }.await()
    }
    suspend fun consumed(id: Long, key: ComposerDrafts.Key, mergedText: String = "", combined: List<ComposerAttachment>? = null, onCommitted: () -> Unit = {}): Boolean {
        val epoch = identity.get()
        return enqueue { box ->
            val accepted = epoch == identity.get() && actorIdentity == epoch && box.consumed(id, key, mergedText, combined)
            if (accepted) publish(box) { if (epoch == identity.get()) onCommitted() }
            accepted
        }.await()
    }
    fun cancel(id: Long? = null) {
        if (id != null && state.value?.id != id) return
        if (!cancelQueued.compareAndSet(false, true)) return
        enqueue {
            val target = id ?: it.state.value?.id
            try { if (id == null || it.state.value?.id == id) it.cancel(); cancelFailure = null; cancelFailureId = null }
            catch (failure: Throwable) { cancelFailure = failure; cancelFailureId = target; throw failure }
            finally { cancelQueued.set(false) }
        }
    }
    fun identityReset() = synchronized(queueLock) {
        // Publish the epoch and enqueue its reset atomically with respect to new bind/edit requests.
        val epoch = identity.incrementAndGet()
        optimistic.clear(); clearing.clear(); keyVersions.clear()
        uiScope.launch { mutable.value = mutable.value?.takeIf { it.accountId == null }; mutableRevision.value++ }
        enqueue {
            if (epoch == identity.get()) {
                try { it.identityReset(); actorIdentity = epoch; identityFailure = null; retireObsoleteCancel(it) }
                catch (failure: Throwable) { identityFailure = failure; throw failure }
            }
        }
        Unit
    }
    suspend fun forgetAttachment(key: ComposerDrafts.Key, id: String) = enqueue { it.forgetAttachment(key, id) }.await()
    suspend fun sent(key: ComposerDrafts.Key, files: List<ComposerAttachment> = emptyList()) {
        val version = invalidate(key)
        enqueue { it.handoff(files); it.sent(key) }.await()
        finishClear(key, version)
    }
    suspend fun drop(key: ComposerDrafts.Key) {
        val version = invalidate(key)
        enqueue { it.drop(key) }.await()
        finishClear(key, version)
    }
    suspend fun pruneTeams(accountId: String, allowed: Set<String>) {
        val epoch = identity.get()
        val removed = view.texts.keys.filter { it.accountId == accountId && it.teamId !in allowed }.associateWith(::invalidate)
        enqueue { if (epoch == identity.get() && actorIdentity == epoch) it.pruneTeams(allowed, accountId) }.await()
        removed.forEach { (key, version) -> finishClear(key, version) }
    }
    suspend fun handoff(files: List<ComposerAttachment>) = enqueue { it.handoff(files) }.await()
    fun releaseLater(files: List<ComposerAttachment>) { enqueue { it.releaseUnowned(files) } }
    suspend fun releaseUnowned(files: List<ComposerAttachment>) = enqueue { it.releaseUnowned(files) }.await()
}
