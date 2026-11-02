package ai.nuphos.android.session

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/**
 * Routing chooses a local draft only; the composer remains the sole consumption owner.
 * It is idempotent: a restarted route reopens a choice for the current draft and releases a stale one,
 * so an interrupted attempt never needs cleanup that could race with a newer attempt.
 */
internal suspend fun openSharedNewDraft(
    request: IncomingShares.Pending,
    key: ComposerDrafts.Key,
    current: () -> Boolean,
    choose: suspend (Long, ComposerDrafts.Key) -> Boolean,
    navigate: () -> Unit,
    release: (Long, ComposerDrafts.Key) -> Unit,
): Boolean {
    if (request.loading || request.error != null || request.accountId != key.accountId ||
        key.destination != ComposerDrafts.Destination.NewChat || !current()) return false
    when (val chosen = request.destination) {
        key -> { navigate(); return true }
        null -> Unit
        else -> { release(request.id, chosen); return false }
    }
    if (!choose(request.id, key)) return false
    currentCoroutineContext().ensureActive()
    if (!current()) return false
    navigate()
    return true
}
