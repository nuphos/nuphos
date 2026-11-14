package ai.nuphos.android.model

/** New-composer state only, matching iOS CredentialDraft. Never persisted or applied to stored chats. */
data class CredentialDraft(
    val catalog: CredentialCatalog? = null,
    val error: String? = null,
    val selection: CredentialSelection = CredentialSelection(newConversation = true),
    private val load: Long = 0,
    /** The newest request whose result is shown: an older one never replaces it. */
    private val shown: Long = 0,
) {
    val isReady: Boolean get() = catalog != null || error != null

    fun begin(): CredentialDraft = copy(load = load + 1)
    val request: Long get() = load

    fun finish(request: Long, result: Result<CredentialCatalog>): CredentialDraft {
        // Any request newer than the shown result counts, not only the latest started: that one
        // may be cancelled and never finish, which would leave the picker loading forever (#2580).
        if (request <= shown) return this
        return result.fold(
            onSuccess = { fresh -> copy(catalog = fresh, error = null, shown = request,
                selection = (if (catalog == null) selection.selectDefaults(fresh) else selection).pruned(fresh)) },
            onFailure = { copy(error = it.message ?: "Could not load IAM. Try again.", shown = request) },
        )
    }

    /** Orphan requests even after switching away and back to the same team. */
    fun reset(): CredentialDraft = CredentialDraft(load = load, shown = load)
}
