package ai.nuphos.android.session

import ai.nuphos.android.R
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.ConnectorHttpFailure
import ai.nuphos.android.data.ConnectorTransport
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.*
import kotlinx.coroutines.CancellationException
import java.security.SecureRandom
import java.time.Instant

interface ConnectorPendingStorage {
    fun read(): ConnectorPending?
    fun write(pending: ConnectorPending?)
}
class ConnectorsStore(
    private val transport: ConnectorTransport,
    private val storage: ConnectorPendingStorage? = null,
    private val now: () -> Long = System::currentTimeMillis,
) {
    enum class Phase { Idle, Loading, Loaded, Failed }
    var team: Team? by mutableStateOf(null); private set
    var inventory by mutableStateOf(ConnectorInventory()); private set
    var phase by mutableStateOf(Phase.Idle); private set
    var loadError: String? by mutableStateOf(null); private set
    var actionError: String? by mutableStateOf(null); private set
    var notice: String? by mutableStateOf(null); private set
    var busy by mutableStateOf(false); private set
    var uncertain by mutableStateOf(false); private set
    var pending: ConnectorPending? by mutableStateOf(storage?.read()); private set
    private val retiredStates = linkedSetOf<String>()
    private var generation = 0
    private var refreshGeneration = 0
    val canAdd get() = team?.isAdministrator == true && !busy && pending == null && !uncertain

    suspend fun select(selected: Team?) {
        if (team?.id == selected?.id) { team = selected; return }
        generation++
        refreshGeneration++
        val old = pending
        team = selected
        inventory = ConnectorInventory()
        phase = Phase.Idle
        busy = false
        uncertain = false
        actionError = null
        notice = null
        if (old != null && selected != null && old.teamId != selected.id) {
            clearPending()
            cleanup(old)
        }
        if (selected != null) refresh()
    }
    suspend fun refresh(): Boolean {
        val selected = team ?: return false
        val generation = generation
        val request = ++refreshGeneration
        phase = Phase.Loading
        return try {
            val result = fetch(selected.id)
            if (generation != this.generation || request != refreshGeneration) false else {
                inventory = result
                phase = Phase.Loaded
                loadError = null
                true
            }
        } catch (e: CancellationException) { throw e } catch (_: Exception) {
            if (generation == this.generation && request == refreshGeneration) {
                phase = Phase.Failed
                loadError = Words(R.string.storetext_connectors_load_failed)
            }
            false
        }
    }
    private suspend fun fetch(teamId: String) = ConnectorInventory.decode(transport.request("GET", teamId, "connectors", null, emptyMap()))
    private fun same(selected: Team, operation: Int) = generation == operation && team?.id == selected.id
    private fun clearPending() {
        pending?.state?.let { retiredStates.add(it) }
        while (retiredStates.size > 32) retiredStates.remove(retiredStates.first())
        pending = null
        storage?.write(null)
    }
    private fun rememberPending(value: ConnectorPending) { pending = value; storage?.write(value) }
    private suspend fun cleanup(value: ConnectorPending) {
        val provider = ConnectorCatalog.named(value.provider) ?: return
        if (!provider.oauth) return
        try { transport.request("DELETE", value.teamId, "${provider.path}/start-oauth/${value.state}", null, emptyMap()) }
        catch (e: CancellationException) { throw e } catch (_: Exception) { /* best effort; readback is separate */ }
    }
    suspend fun bind(provider: ConnectorProvider, values: Map<String, String>): Boolean {
        val selected = team ?: return false
        if (!canAdd || provider.fields.isEmpty() || ConnectorCatalog.named(provider.key) != provider) return false
        val validation = provider.validate(values)
        if (!validation.valid) { actionError = Words(R.string.storetext_connectors_check_fields); return false }
        busy = true
        actionError = null
        notice = null
        val operation = generation
        return try {
            val result = transport.request("POST", selected.id, provider.path!!, JsonValue.Obj(validation.body.mapValues { JsonValue.Str(it.value) }), emptyMap())
            val ids = ConnectorInventory.createdIds(result)
            val refreshed = fetch(selected.id)
            if (!same(selected, operation)) false else {
                inventory = refreshed
                phase = Phase.Loaded
                val confirmed = ids.isNotEmpty() && refreshed.rows.any { it.provider == provider.key && it.bindingId in ids }
                if (confirmed) { notice = Words(R.string.storetext_connectors_saved); true } else {
                    uncertain = true
                    actionError = Words(R.string.storetext_connectors_save_unverified)
                    false
                }
            }
        } catch (e: CancellationException) {
            if (same(selected, operation)) {
                uncertain = true
                actionError = Words(R.string.storetext_connectors_save_interrupted)
            }
            throw e
        } catch (failure: Exception) {
            // A lost response may have saved the connector. Do not enable an automatic duplicate POST.
            val readback = runCatching { fetch(selected.id) }.getOrNull()
            if (same(selected, operation)) {
                if (readback != null) { inventory = readback; phase = Phase.Loaded }
                uncertain = failure !is ConnectorHttpFailure || failure.code >= 500 || failure.code in setOf(408, 409)
                actionError = if (uncertain) Words(R.string.storetext_connectors_save_unconfirmed) else Words(R.string.storetext_connectors_save_rejected, (failure as ConnectorHttpFailure).code)
            }
            false
        } finally { if (same(selected, operation)) busy = false }
    }
    fun closeForm() {
        if (!busy) { uncertain = false; actionError = null }
    }
    suspend fun start(provider: ConnectorProvider): String? {
        val selected = team ?: return null
        if (!canAdd || !(provider.oauth || provider.key == "github") || ConnectorCatalog.named(provider.key) != provider) return null
        busy = true
        actionError = null
        notice = null
        val operation = generation
        var started: ConnectorPending? = null
        return try {
            val githubState = if (provider.key == "github") ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it.toInt() and 255) } else null
            val response = transport.request(if (provider.oauth) "POST" else "GET", selected.id, if (provider.oauth) "${provider.path}/start-oauth" else "${provider.path}/install-url", null, githubState?.let { mapOf("state" to it) } ?: emptyMap())
            val state = githubState ?: response["state"]?.stringValue ?: error("Invalid response")
            if (!Regex("^[0-9a-fA-F]{1,128}$").matches(state)) error("Invalid response")
            val expires = if (provider.oauth) Instant.parse(response["expiresAt"]?.stringValue).toEpochMilli() else now() + 600_000
            started = ConnectorPending(selected.id, provider.key, state, expires)
            val url = response[if (provider.oauth) "authorizeUrl" else "url"]?.stringValue ?: error("Invalid response")
            if (!validHttpUrl(url) || expires <= now()) error("Invalid response")
            if (!same(selected, operation)) { cleanup(started); null } else { rememberPending(started); url }
        } catch (e: CancellationException) { started?.let { cleanup(it) }; throw e } catch (_: Exception) {
            started?.let { cleanup(it) }
            if (same(selected, operation)) actionError = Words(R.string.storetext_connectors_start_failed)
            null
        } finally { if (same(selected, operation)) busy = false }
    }
    suspend fun cancel(message: String = Words(R.string.storetext_connectors_auth_canceled)) {
        val value = pending ?: return
        clearPending() // Invalidate before any suspension; late callbacks cannot bind.
        val operation = ++generation
        busy = false
        cleanup(value)
        if (generation == operation && team?.id == value.teamId) {
            refresh()
            if (generation == operation) notice = message
        }
    }
    suspend fun expire() {
        if (pending?.expiresAt?.let { now() >= it } == true) cancel(Words(R.string.storetext_connectors_auth_expired))
    }
    suspend fun handleCallback(uri: String) {
        if (!ConnectorCallback.isConnectorUri(uri)) return
        if (ConnectorCallback.state(uri) in retiredStates) return
        val value = pending
        if (value == null) {
            if (ConnectorCallback.state(uri) in retiredStates) return
            if (team != null) refresh()
            notice = Words(R.string.storetext_connectors_no_pending)
            return
        }
        if (team?.id != value.teamId || team?.isAdministrator != true) { cancel(Words(R.string.storetext_connectors_auth_other_team)); return }
        if (ConnectorCallback.state(uri) != value.state) return
        val result = ConnectorCallback.validate(uri, value, now())
        if (result is ConnectorReturn.Invalid) { cancel(result.message); return }
        // Consume once before POST/readback. Replay must not trigger another GitHub bind.
        clearPending()
        val selected = team!!
        val operation = generation
        busy = true
        actionError = null
        try {
            var expectedId: String? = null
            var oauthId = (result as? ConnectorReturn.OAuth)?.bindingId
            if (result is ConnectorReturn.Deferred) {
                val response = transport.request("POST", value.teamId, "connector-oauth/${value.state}/complete", JsonValue.obj("code" to JsonValue.Str(result.code)), emptyMap())
                oauthId = response["binding_id"]?.stringValue
            }
            if (result is ConnectorReturn.Github) {
                try {
                    val response = transport.request("POST", value.teamId, "github-installations", JsonValue.obj("installationId" to JsonValue.Number(result.installationId.toDouble())), emptyMap())
                    expectedId = ConnectorInventory.bindingId(response)
                } catch (failure: ConnectorHttpFailure) {
                    if (failure.code != 409) throw failure
                }
            }
            val refreshed = fetch(value.teamId)
            if (same(selected, operation)) {
                inventory = refreshed
                phase = Phase.Loaded
                val confirmed = when (result) {
                    is ConnectorReturn.OAuth, is ConnectorReturn.Deferred -> oauthId?.let { refreshed.contains(value.provider, it) } == true
                    is ConnectorReturn.Github -> refreshed.rows.any { it.provider == "github" && it.installationId == result.installationId && (expectedId == null || it.bindingId == expectedId) }
                    else -> false
                }
                if (confirmed) notice = Words(R.string.storetext_connectors_saved) else actionError = Words(R.string.storetext_connectors_auth_missing)
            }
        } catch (e: CancellationException) { throw e } catch (_: Exception) {
            if (same(selected, operation)) {
                uncertain = true
                actionError = Words(R.string.storetext_connectors_auth_unconfirmed)
                refresh()
            }
        } finally { if (same(selected, operation)) busy = false }
    }
}
