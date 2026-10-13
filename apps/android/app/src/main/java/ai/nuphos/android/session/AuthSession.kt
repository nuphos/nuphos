package ai.nuphos.android.session

import android.app.Activity
import android.app.Application
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.AccountApi
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.data.NuphosWeb
import ai.nuphos.android.data.NativeLogin
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
    val aiAllowed: Boolean get() = token?.let { AiAccess.allows(it) } == true
    val composerDrafts = ComposerDrafts()
    val runtimeSelections = RuntimeSelections()
    var workspaceWriteReview = WorkspaceWriteReview()
        private set
    private var consentRequest = 0L

    private fun beginIdentity(): Long {
        composerDrafts.onIdentity(null)
        runtimeSelections.clear()
        workspaceWriteReview = WorkspaceWriteReview()
        generation++
        consentRequest++
        consentVersion = null
        consentError = null
        consentBusy = false
        profileError = null
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
                    consentError = "Your AI access changed. Reload your sharing choice before continuing."
                    return@launch
                }
                consentVersion = result.version
                if (result.version == AccountApi.AI_CONSENT_VERSION && result.accepted) {
                    if (!AiAccess.grantIfCurrent(current, revision)) {
                        consentVersion = null
                        consentError = "Your AI access changed. Reload your sharing choice before continuing."
                    }
                } else {
                    composerDrafts.clear()
                    runtimeSelections.clear()
                    AiAccess.revoke()
                    if (result.version != AccountApi.AI_CONSENT_VERSION) {
                        consentError = "This privacy notice has changed. Please update Nuphos before using AI."
                    }
                }
            } catch (_: NuphosApi.Failure.Unauthorized) {
                if (matches(expected, current) && request == consentRequest) signOut(NuphosApi.Failure.Unauthorized.message)
            } catch (_: Exception) {
                if (matches(expected, current) && request == consentRequest) {
                    AiAccess.revoke()
                    consentVersion = null
                    consentError = "We could not load your AI sharing choice. Retry or manage your account."
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
                    consentError = "Your AI access changed. Reload your sharing choice before continuing."
                    return@launch
                }
                consentVersion = result.version
                if (result.version == AccountApi.AI_CONSENT_VERSION && result.accepted == accepted) {
                    if (accepted) {
                        if (!AiAccess.grantIfCurrent(current, revision)) {
                            consentVersion = null
                            consentError = "Your AI access changed. Reload your sharing choice before continuing."
                        }
                    } else {
                        composerDrafts.clear()
                        runtimeSelections.clear()
                        AiAccess.revokeIfCurrent(current, revision)
                    }
                } else {
                    AiAccess.revoke()
                    consentError = "Nuphos could not confirm your AI sharing choice. Please retry."
                }
            } catch (_: NuphosApi.Failure.Unauthorized) {
                if (matches(expected, current)) signOut(NuphosApi.Failure.Unauthorized.message)
            } catch (e: Exception) {
                if (matches(expected, current) && request == consentRequest) consentError = e.message ?: "We could not save your choice."
            } finally {
                if (generation == expected && request == consentRequest) consentBusy = false
            }
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
            if (matches(expected, current)) profileError = if (e is NuphosApi.Failure.Http && e.code == 409)
                "That username is already in use. Choose another one." else e.message ?: "We could not save your profile."
            false
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var customTabsOpen = false
    private var loginAttempt: NativeLogin? = null
    private var loginJob: Job? = null
    private var loginResumed: CompletableDeferred<Unit>? = null

    fun restore() {
        if (state is State.SigningIn || (state is State.SignedIn && token != null)) return
        val expected = beginIdentity()
        scope.launch {
            val saved = withContext(Dispatchers.IO) { tokenStore.read() }
            if (generation != expected) return@launch
            if (saved == null) {
                state = State.SignedOut(null)
                return@launch
            }
            token = saved
            try {
                val restored = NuphosApi.currentUser(saved)
                if (generation != expected) return@launch
                AiAccess.activate(saved)
                composerDrafts.onIdentity(restored.id)
                state = State.SignedIn(restored)
                loadAIConsent()
            } catch (_: NuphosApi.Failure.Unauthorized) {
                if (generation != expected) return@launch
                clearToken()
                state = State.SignedOut(null)
            } catch (_: Exception) {
                if (generation != expected) return@launch
                state = State.SignedOut("We could not reach Nuphos. Check your connection and try again.")
            }
        }
    }

    fun signIn(activity: Activity) {
        if (state !is State.SignedOut) return
        val expected = beginIdentity()
        state = State.SigningIn
        customTabsOpen = false
        val resumed = CompletableDeferred<Unit>()
        loginResumed = resumed
        loginJob = scope.launch {
            var attempt: NativeLogin? = null
            try {
                attempt = NativeLogin()
                loginAttempt = attempt
                val url = withContext(Dispatchers.IO) { attempt.register() }
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
                if (withTimeoutOrNull(5 * 60 * 1000L) { resumed.await(); true } != true) {
                    throw java.net.SocketTimeoutException("Sign-in expired. Please try again.")
                }
                val received = withContext(Dispatchers.IO) { attempt.redeem(code) }
                val user = NuphosApi.currentUser(received)
                ensureActive()
                if (generation != expected || state !is State.SigningIn || loginAttempt !== attempt) return@launch
                tokenStore.write(received)
                token = received
                AiAccess.activate(received)
                composerDrafts.onIdentity(user.id)
                state = State.SignedIn(user)
                loadAIConsent()
            } catch (e: CancellationException) {
                throw e
            } catch (_: ActivityNotFoundException) {
                if (generation == expected) state = State.SignedOut("We could not open the sign-in window. Please try again.")
            } catch (_: Exception) {
                if (generation == expected) state = State.SignedOut("Secure sign-in did not complete. Check your connection and try again.")
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

    /** A browser return only changes focus. An intent can never supply identity. */
    fun handleCallback(uri: Uri): Boolean = NuphosWeb.isReturnIntent(uri)

    /** Called from [Activity.onResume] after Custom Tabs returns. */
    fun onHostResumed() {
        if (state is State.SignedIn && !consentBusy) loadAIConsent()
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

    fun signOut(error: String? = null) {
        beginIdentity()
        customTabsOpen = false
        cancelLogin()
        clearToken()
        state = State.SignedOut(error)
    }

    private fun clearToken() {
        tokenStore.clear()
        token = null
    }
}
