package ai.nuphos.android.session

import android.app.Activity
import android.app.Application
import ai.nuphos.android.R
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.BackendOrigin
import ai.nuphos.android.data.AccountApi
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.data.NuphosWeb
import ai.nuphos.android.data.NativeLogin
import ai.nuphos.android.data.SavedAccount
import ai.nuphos.android.data.SavedAccounts
import ai.nuphos.android.data.TokenStore
import ai.nuphos.android.model.NuphosUser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/**
 * Source of truth for who is signed in. One instance lives for the app's
 * lifetime; screens read [state] from it.
 */
class AuthSession(
    private val app: Application,
    private val tokenStore: TokenStore,
    private val launchConsent: LaunchConsent = LaunchConsent.preferences(app),
) {
    sealed class State {
        data object Restoring : State()
        data class SignedOut(val error: String?) : State()
        data object SigningIn : State()
        data class SignedIn(val user: NuphosUser) : State()
    }

    var state: State by mutableStateOf(State.Restoring)
        private set
    var token: String? = null
        private set

    var serverOrigin: String by mutableStateOf(BackendOrigin.current)
        private set

    /** The server can only change at the signed-out boundary. */
    fun selectServer(address: String) {
        check(state is State.SignedOut) { "Sign out before changing servers." }
        val origin = BackendOrigin.normalize(address)
        if (origin == serverOrigin) return
        useServer(origin)
        cancelLogin()
        beginIdentity()
        clearToken()
        state = State.SignedOut(null)
    }

    private fun useServer(origin: String) {
        if (origin == serverOrigin) return
        check(app.getSharedPreferences("nuphos.backend", Application.MODE_PRIVATE)
            .edit().putString("origin", origin).commit()) { "Could not save the server address." }
        (app as? ai.nuphos.android.NuphosApplication)?.conversationLinks?.clear()
        BackendOrigin.select(origin)
        serverOrigin = origin
    }

    /** Every account kept on this device; the current one holds [token]. */
    var savedAccounts: List<SavedAccount> by mutableStateOf(emptyList())
        private set
    /** While adding an account, the one that Cancel returns to. */
    var addingFrom: String? by mutableStateOf(null)
        private set

    private fun saveAccounts(next: List<SavedAccount>) {
        tokenStore.accounts = next
        savedAccounts = next
    }

    /** Starts a sign-in beside the current account, which stays saved. */
    fun addAccount(origin: String = serverOrigin) {
        if (state is State.SigningIn) return
        val current = token?.let { t -> savedAccounts.firstOrNull { it.token == t }?.id }
        beginIdentity()
        cancelLogin()
        token = null
        useServer(origin)
        addingFrom = current ?: addingFrom
        state = State.SignedOut(null)
    }

    fun cancelAddAccount() {
        val back = addingFrom ?: return
        addingFrom = null
        selectAccount(back)
    }

    /** Switching never ends the previous session on the server; it stays saved. */
    fun selectAccount(id: String) {
        val account = savedAccounts.firstOrNull { it.id == id } ?: return
        val saved = account.token ?: return addAccount(account.origin)
        if (state is State.SigningIn || (saved == token && state is State.SignedIn)) return
        beginIdentity()
        cancelLogin()
        token = null
        addingFrom = null
        useServer(account.origin)
        BackendOrigin.bind(saved, account.origin)
        tokenStore.write(saved)
        state = State.Restoring
        val expected = generation
        scope.launch {
            // Let the previous account's queued private-draft deletion finish first.
            try { awaitIdentityCleanup?.invoke() } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                if (generation == expected) state = State.SignedOut(app.getString(R.string.shell_auth_cleanup_failed))
                return@launch
            }
            if (generation == expected) restore()
        }
    }

    /** Signs one account out; the current one goes through [signOut]. */
    fun removeAccount(id: String) {
        val account = savedAccounts.firstOrNull { it.id == id } ?: return
        if (account.token != null && account.token == token) return signOut()
        saveAccounts(SavedAccounts.forget(savedAccounts, id))
        if (addingFrom == id) addingFrom = null
        account.token?.let { ended ->
            BackendOrigin.bind(ended, account.origin)
            scope.launch { AccountApi(ended).endSession() }
        }
    }

    val user: NuphosUser?
        get() = (state as? State.SignedIn)?.user

    var generation: Long by mutableStateOf(0L)
        private set
    var consentVersion: String? by mutableStateOf(null)
        private set
    var consentBusy by mutableStateOf(false)
        private set
    var consentError: String? by mutableStateOf(null)
        private set
    var profileError: String? by mutableStateOf(null)
        private set
    /** Home opened from the saved account, and the server has not answered for it yet. */
    var unverified by mutableStateOf(false)
        private set
    /** The token whose AI access came from [launchConsent] and the server has not confirmed. */
    private var launchGrant: String? = null
    /** A sign-in that needs the account's second factor; the sign-in screen asks for the code. */
    var mfaChallenge: String? by mutableStateOf(null)
        private set
    val aiAllowed: Boolean get() = token?.let { AiAccess.allows(it) } == true
    val composerDrafts = ComposerDrafts(ai.nuphos.android.data.ComposerDraftPreferences(app))
    val runtimeSelections = RuntimeSelections()
    var workspaceWriteReview = WorkspaceWriteReview()
        private set
    private var consentRequest = 0L

    var onIdentityReset: () -> Unit = {}
    /** Optional durable cleanup barrier; the application supplies its ordered shared-draft actor. */
    var awaitIdentityCleanup: (suspend () -> Unit)? = null
    /** Runs before a sign-out ends its session on the server, for work that still needs the token. */
    var beforeSessionEnd: suspend () -> Unit = {}

    private fun beginIdentity(preserveDrafts: Boolean = false): Long {
        if (state !is State.Restoring) onIdentityReset()
        if (!preserveDrafts) {
            composerDrafts.clear()
            // Starting another identity must not inherit the prior account's billable key,
            // including after restoration failed because of a transient network error.
            app.deleteSharedPreferences("nuphos.voice")
        }
        composerDrafts.onIdentity(null)
        runtimeSelections.clear()
        workspaceWriteReview = WorkspaceWriteReview()
        generation++
        consentRequest++
        consentVersion = null
        consentError = null
        consentBusy = false
        profileError = null
        unverified = false
        launchGrant = null
        AiAccess.revoke()
        return generation
    }

    private fun matches(expected: Long, expectedToken: String) =
        generation == expected && token == expectedToken && state is State.SignedIn

    fun loadAIConsent() {
        val current = token ?: return
        val expected = generation
        val request = ++consentRequest
        val revision = AiAccess.revision
        consentBusy = true
        consentError = null
        scope.launch {
            try {
                val result = AccountApi(current).consent()
                if (!matches(expected, current) || request != consentRequest) return@launch
                if (AiAccess.revision != revision) {
                    consentVersion = null
                    consentError = app.getString(R.string.shell_auth_ai_access_changed)
                    return@launch
                }
                consentVersion = result.version
                if (launchGrant == current) launchGrant = null
                if (result.version == AccountApi.AI_CONSENT_VERSION && result.accepted) {
                    if (!AiAccess.grantIfCurrent(current, revision)) {
                        consentVersion = null
                        consentError = app.getString(R.string.shell_auth_ai_access_changed)
                    } else user?.let { launchConsent.remember(current, it.id, result.version) }
                } else {
                    launchConsent.clear()
                    composerDrafts.clear()
                    onIdentityReset()
                    runtimeSelections.clear()
                    AiAccess.revoke()
                    if (result.version != AccountApi.AI_CONSENT_VERSION) {
                        consentError = app.getString(R.string.shell_auth_privacy_notice_changed)
                    }
                }
            } catch (_: NuphosApi.Failure.Unauthorized) {
                if (matches(expected, current) && request == consentRequest) signOut(NuphosApi.Failure.Unauthorized.message)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (!matches(expected, current) || request != consentRequest) return@launch
                if (launchGrant == current && AiAccess.allows(current)) {
                    // Offline launch: Home opened from the consent this device saw accepted stays.
                    unverified = true
                } else {
                    AiAccess.revoke()
                    consentVersion = null
                    consentError = app.getString(R.string.shell_auth_consent_load_failed)
                }
            } finally {
                if (generation == expected && request == consentRequest) consentBusy = false
            }
        }
    }

    fun setAIConsent(accepted: Boolean) {
        val current = token ?: return
        if (consentBusy || consentVersion != AccountApi.AI_CONSENT_VERSION) return
        val expected = generation
        val request = ++consentRequest
        val revision = AiAccess.revision
        consentBusy = true
        consentError = null
        scope.launch {
            try {
                val result = AccountApi(current).setConsent(accepted)
                if (!matches(expected, current) || request != consentRequest) return@launch
                if (AiAccess.revision != revision) {
                    consentVersion = null
                    consentError = app.getString(R.string.shell_auth_ai_access_changed)
                    return@launch
                }
                consentVersion = result.version
                if (result.version == AccountApi.AI_CONSENT_VERSION && result.accepted == accepted) {
                    if (accepted) {
                        if (!AiAccess.grantIfCurrent(current, revision)) {
                            consentVersion = null
                            consentError = app.getString(R.string.shell_auth_ai_access_changed)
                        } else user?.let { launchConsent.remember(current, it.id, result.version) }
                    } else {
                        launchConsent.clear()
                        composerDrafts.clear()
                        onIdentityReset()
                        runtimeSelections.clear()
                        AiAccess.revokeIfCurrent(current, revision)
                    }
                } else {
                    launchConsent.clear()
                    AiAccess.revoke()
                    consentError = app.getString(R.string.shell_auth_consent_unconfirmed)
                }
            } catch (_: NuphosApi.Failure.Unauthorized) {
                if (matches(expected, current)) signOut(NuphosApi.Failure.Unauthorized.message)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (matches(expected, current) && request == consentRequest) consentError = e.message ?: app.getString(R.string.shell_auth_consent_save_failed)
            } finally {
                if (generation == expected && request == consentRequest) consentBusy = false
            }
        }
    }

    /** Uploads a profile photo, or removes it with `null`. */
    suspend fun setAvatar(image: ByteArray?): Boolean {
        val current = token ?: return false
        val expected = generation
        val id = user?.id ?: return false
        profileError = null
        return try {
            val updated = AccountApi(current).setAvatar(image)
            if (!matches(expected, current) || updated.id != id) false
            else { state = State.SignedIn(updated); true }
        } catch (_: NuphosApi.Failure.Unauthorized) {
            if (matches(expected, current)) signOut(NuphosApi.Failure.Unauthorized.message)
            false
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            if (matches(expected, current)) profileError = e.message ?: app.getString(R.string.shell_auth_photo_failed)
            false
        }
    }

    suspend fun updateProfile(name: String, username: String, avatarURL: String): Boolean {
        val current = token ?: return false
        val expected = generation
        val id = user?.id ?: return false
        profileError = null
        return try {
            val updated = AccountApi(current).updateProfile(name, username, avatarURL)
            if (!matches(expected, current) || updated.id != id) false
            else { state = State.SignedIn(updated); true }
        } catch (_: NuphosApi.Failure.Unauthorized) {
            if (matches(expected, current)) signOut(NuphosApi.Failure.Unauthorized.message)
            false
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            if (matches(expected, current)) profileError = if (e is NuphosApi.Failure.Http && e.code == 409)
                app.getString(R.string.shell_auth_username_taken) else e.message ?: app.getString(R.string.shell_auth_profile_failed)
            false
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var customTabsOpen = false
    private var loginAttempt: NativeLogin? = null
    private var loginJob: Job? = null
    private var loginResumed: CompletableDeferred<Unit>? = null

    fun restore() {
        if (state is State.SigningIn || (state is State.SignedIn && token != null) || addingFrom != null) return
        val expected = beginIdentity(preserveDrafts = true)
        scope.launch {
            val (saved, accounts) = withContext(Dispatchers.IO) { tokenStore.read() to tokenStore.accounts }
            if (generation != expected) return@launch
            savedAccounts = accounts
            if (saved == null) {
                composerDrafts.clear()
                state = State.SignedOut(null)
                return@launch
            }
            token = saved
            val account = accounts.firstOrNull { it.token == saved }
            if (account != null && launchConsent.accepted(saved, account.user.id)) {
                // Open Home from what this device knows, then check it with the server.
                AiAccess.activate(saved)
                AiAccess.grantIfCurrent(saved, AiAccess.revision)
                launchGrant = saved
                consentVersion = AccountApi.AI_CONSENT_VERSION
                composerDrafts.onIdentity(account.user.id)
                state = State.SignedIn(account.user)
                verify(expected, saved, account.user.id)
                return@launch
            }
            try {
                val restored = NuphosApi.currentUser(saved)
                if (generation != expected) return@launch
                enter(restored, saved)
            } catch (_: NuphosApi.Failure.Unauthorized) {
                if (generation != expected) return@launch
                saveAccounts(SavedAccounts.expire(savedAccounts, saved))
                clearToken()
                state = State.SignedOut(null)
            } catch (_: Exception) {
                if (generation != expected) return@launch
                state = State.SignedOut(app.getString(R.string.shell_auth_unreachable))
            }
        }
    }

    /** Checks a Home opened from the saved account. Only a refused token or another user signs out. */
    private fun verify(expected: Long, saved: String, userId: String) {
        scope.launch {
            try {
                val confirmed = NuphosApi.currentUser(saved)
                if (!matches(expected, saved)) return@launch
                if (confirmed.id != userId) throw NuphosApi.Failure.Unauthorized
                tokenStore.write(saved)
                saveAccounts(SavedAccounts.remember(savedAccounts, BackendOrigin.forToken(saved), confirmed, saved))
                unverified = false
                state = State.SignedIn(confirmed)
                loadAIConsent()
            } catch (_: NuphosApi.Failure.Unauthorized) {
                if (!matches(expected, saved)) return@launch
                // As before Home opened early: the refused token is dropped, and its account asks to sign in again.
                beginIdentity()
                saveAccounts(SavedAccounts.expire(savedAccounts, saved))
                clearToken()
                state = State.SignedOut(app.getString(R.string.shell_auth_account_expired))
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                // Offline: the Home opened from the saved account stays, and the next resume checks again.
                if (matches(expected, saved)) unverified = true
            }
        }
    }

    fun signIn(activity: Activity, provider: NuphosWeb.Provider) {
        if (state !is State.SignedOut) return
        val expected = beginIdentity()
        val origin = serverOrigin
        state = State.SigningIn
        customTabsOpen = false
        val resumed = CompletableDeferred<Unit>()
        loginResumed = resumed
        loginJob = scope.launch {
            var attempt: NativeLogin? = null
            try {
                attempt = NativeLogin()
                loginAttempt = attempt
                val url = withContext(Dispatchers.IO) { attempt.register(provider) }
                if (generation != expected || state !is State.SigningIn) return@launch
                if (activity.isFinishing || activity.isDestroyed) throw ActivityNotFoundException()
                val tabs = CustomTabsIntent.Builder()
                    .setShowTitle(true)
                    .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
                    .build()
                tabs.intent.addFlags(Intent.FLAG_ACTIVITY_NO_HISTORY)
                customTabsOpen = true
                tabs.launchUrl(activity, Uri.parse(url))
                val code = withContext(Dispatchers.IO) { attempt.awaitDelivery() }
                ensureActive()
                if (generation != expected || state !is State.SigningIn || loginAttempt !== attempt) return@launch
                // Only a validated loopback delivery may bring the host back. This
                // intent carries no code or token; redemption still waits for onResume.
                if (!activity.isFinishing && !activity.isDestroyed) {
                    try {
                        activity.startActivity(Intent(activity, ai.nuphos.android.MainActivity::class.java).apply {
                            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                        })
                    } catch (_: ActivityNotFoundException) {
                        // Keep the callback page's manual return link as a fallback.
                    } catch (_: SecurityException) {
                        // Browser/OS policy may require the user to return manually.
                    }
                }
                if (withTimeoutOrNull(5 * 60 * 1000L) { resumed.await(); true } != true) {
                    throw java.net.SocketTimeoutException("Sign-in expired. Please try again.")
                }
                val received = withContext(Dispatchers.IO) { attempt.redeem(code) }
                ensureActive()
                if (generation != expected || serverOrigin != origin) return@launch
                BackendOrigin.bind(received, origin)
                val user = NuphosApi.currentUser(received)
                ensureActive()
                if (generation != expected || state !is State.SigningIn || loginAttempt !== attempt) return@launch
                enter(user, received)
            } catch (e: CancellationException) {
                throw e
            } catch (_: ActivityNotFoundException) {
                if (generation == expected) state = State.SignedOut(app.getString(R.string.shell_auth_window_failed))
            } catch (e: NuphosApi.Failure.MfaRequired) {
                if (generation == expected) askForMfa(e.challenge)
            } catch (_: Exception) {
                if (generation == expected) state = State.SignedOut(app.getString(R.string.shell_auth_secure_incomplete))
            } finally {
                attempt?.close()
                if (loginAttempt === attempt) {
                    loginAttempt = null
                    loginJob = null
                    loginResumed = null
                    customTabsOpen = false
                }
            }
        }
    }

    fun passwordSignIn(email: String, password: String) = credentialSignIn(email, password, true)

    fun emailSignIn(email: String, code: String) = credentialSignIn(email, code, false)

    /** Editing after a failed attempt clears its message, as on iOS. */
    fun dismissSignInError() {
        val current = state
        if (current is State.SignedOut && current.error != null) state = State.SignedOut(null)
    }

    fun cancelCredentialSignIn() {
        if (state is State.SigningIn && loginAttempt == null) signOut()
    }

    private fun credentialSignIn(email: String, credential: String, password: Boolean) =
        finishSignIn(password, onRefused = null) {
            if (password) AccountApi("").passwordSignIn(email, credential)
            else AccountApi("").emailSignIn(email, credential)
        }

    private fun askForMfa(challenge: String) {
        mfaChallenge = challenge
        state = State.SignedOut(null)
    }

    /** The second step of a sign-in that asked for it. [onRefused] hears why a code was not accepted. */
    fun verifyMfa(code: String, onRefused: (String) -> Unit) {
        val challenge = mfaChallenge ?: return
        finishSignIn(password = false, onRefused = onRefused) {
            AccountApi("").verifyMfa(challenge, code).also { mfaChallenge = null }
        }
    }

    /** The same step answered with a passkey ([ai.nuphos.android.data.Passkeys.answer]). */
    fun verifyMfaPasskey(answer: kotlinx.serialization.json.JsonElement, onRefused: (String) -> Unit) {
        val challenge = mfaChallenge ?: return
        finishSignIn(password = false, onRefused = onRefused) {
            AccountApi("").verifyMfaPasskey(challenge, answer).also { mfaChallenge = null }
        }
    }

    fun cancelMfa() { mfaChallenge = null }

    private fun finishSignIn(password: Boolean, onRefused: ((String) -> Unit)?, obtain: suspend () -> String) {
        if (state !is State.SignedOut) return
        val expected = beginIdentity()
        val origin = serverOrigin
        state = State.SigningIn
        loginJob = scope.launch {
            try {
                val received = try {
                    obtain()
                } catch (e: NuphosApi.Failure.MfaRequired) {
                    if (generation == expected) askForMfa(e.challenge)
                    return@launch
                } catch (e: NuphosApi.Failure.Http) {
                    if (onRefused == null) throw e
                    if (generation == expected) { state = State.SignedOut(null); onRefused(e.message) }
                    return@launch
                } catch (_: NuphosApi.Failure.Unauthorized) {
                    if (generation == expected) state = State.SignedOut(if (password) app.getString(R.string.shell_auth_wrong_password) else app.getString(R.string.shell_auth_code_expired))
                    onRefused?.invoke(app.getString(R.string.shell_auth_code_invalid))
                    return@launch
                }
                ensureActive()
                if (generation != expected || serverOrigin != origin) return@launch
                BackendOrigin.bind(received, origin)
                val user = NuphosApi.currentUser(received)
                ensureActive()
                if (generation != expected || state !is State.SigningIn) return@launch
                enter(user, received)
            } catch (e: CancellationException) {
                throw e
            } catch (_: NuphosApi.Failure.Unauthorized) {
                if (generation == expected) state = State.SignedOut(NuphosApi.Failure.Unauthorized.message)
                onRefused?.invoke(NuphosApi.Failure.Unauthorized.message)
            } catch (e: NuphosApi.Failure.Http) {
                onRefused?.invoke(e.message)
                if (generation == expected) state = State.SignedOut(if (password) e.message else when (e.code) {
                    400 -> app.getString(R.string.shell_auth_code_rejected)
                    429 -> app.getString(R.string.shell_auth_too_many_attempts)
                    else -> app.getString(R.string.shell_auth_email_incomplete)
                })
            } catch (_: Exception) {
                if (generation == expected) state = State.SignedOut(app.getString(R.string.shell_auth_incomplete))
                onRefused?.invoke(app.getString(R.string.shell_auth_incomplete_connection))
            } finally {
                if (generation == expected) loginJob = null
            }
        }
    }

    /** A browser return only changes focus. An intent can never supply identity. */
    fun handleCallback(uri: Uri): Boolean = NuphosWeb.isReturnIntent(uri)

    /** Called from [Activity.onResume] after Custom Tabs returns. */
    fun onHostResumed() {
        val current = token
        val signedIn = user
        if (unverified && current != null && signedIn != null) verify(generation, current, signedIn.id)
        else if (state is State.SignedIn && !consentBusy) loadAIConsent()
        if (state is State.SigningIn && loginAttempt?.receivedCallback == true) loginResumed?.complete(Unit)
        if (state is State.SigningIn && customTabsOpen && loginAttempt?.receivedCallback != true) {
            cancelLogin()
            beginIdentity()
            state = State.SignedOut(null)
        }
    }

    private fun cancelLogin() {
        loginAttempt?.close()
        loginAttempt = null
        loginJob?.cancel()
        loginJob = null
        loginResumed = null
        customTabsOpen = false
    }

    fun refreshUser() {
        val token = token ?: return
        if (state !is State.SignedIn) return
        val expected = generation
        scope.launch {
            try {
                val refreshed = NuphosApi.currentUser(token)
                if (matches(expected, token) && refreshed.id == user?.id) state = State.SignedIn(refreshed)
            } catch (_: NuphosApi.Failure.Unauthorized) {
                if (matches(expected, token)) signOut(NuphosApi.Failure.Unauthorized.message)
            } catch (_: Exception) {
                // Keep showing what we have.
            }
        }
    }

    /** A verified session becomes the current account and stays saved for switching. */
    private fun enter(user: NuphosUser, received: String) {
        tokenStore.write(received)
        saveAccounts(SavedAccounts.remember(savedAccounts, BackendOrigin.forToken(received), user, received))
        token = received
        addingFrom = null
        AiAccess.activate(received)
        composerDrafts.onIdentity(user.id)
        state = State.SignedIn(user)
        loadAIConsent()
    }

    fun signOut(error: String? = null) {
        val ended = token
        // Every sign-out with an error is a rejected session.
        if (ended != null) saveAccounts(SavedAccounts.signedOut(savedAccounts, ended, rejected = error != null))
        addingFrom = null
        val expected = beginIdentity()
        // Signed out here at once; ending the session on the server is best effort.
        if (ended != null) scope.launch {
            beforeSessionEnd()
            AccountApi(ended).endSession()
        }
        customTabsOpen = false
        cancelLogin()
        clearToken()
        val cleanup = awaitIdentityCleanup
        if (cleanup == null) state = State.SignedOut(error)
        else {
            // Hide authenticated UI immediately, but do not acknowledge logout before queued private-draft deletion.
            state = State.Restoring
            scope.launch {
                val cleanupError = try { cleanup(); null }
                catch (failure: Exception) {
                    if (failure is kotlinx.coroutines.CancellationException) throw failure
                    app.getString(R.string.shell_auth_signed_out_cleanup_failed)
                }
                if (generation == expected && token == null) state = State.SignedOut(cleanupError ?: error)
            }
        }
    }

    private fun clearToken() {
        onIdentityReset()
        // Remove BYOK credentials without needing to decrypt a broken keystore.
        app.deleteSharedPreferences("nuphos.voice")
        composerDrafts.clear()
        launchConsent.clear()
        tokenStore.clear()
        token = null
    }
}
