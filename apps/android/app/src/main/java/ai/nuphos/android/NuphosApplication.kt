package ai.nuphos.android

import android.app.Application
import ai.nuphos.android.data.TokenStore
import ai.nuphos.android.session.AuthSession

class NuphosApplication : Application() {
    lateinit var incomingShares: ai.nuphos.android.session.IncomingShares
        private set
    lateinit var shareDraftStore: ai.nuphos.android.data.ShareDraftStore
        private set
    val incomingShareScope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main.immediate)

    val conversationLinks = ai.nuphos.android.session.PendingConversationLink()
    lateinit var localNotifications: ai.nuphos.android.notifications.LocalNotifications
        private set
    lateinit var tokenStore: TokenStore
        private set
    lateinit var authSession: AuthSession
        private set

    lateinit var pushNotifications: ai.nuphos.android.notifications.PushNotifications
        private set

    override fun onCreate() {
        super.onCreate()
        // One-time cleanup of the legacy process-local layout; it had no recoverable metadata.
        val legacyDraftText = ai.nuphos.android.data.ComposerDraftPreferences(this)
        shareDraftStore = ai.nuphos.android.data.ShareDraftStore(java.io.File(noBackupFilesDir, "share-drafts-v1"),
            discardLegacyText = legacyDraftText::erase)
        incomingShares = ai.nuphos.android.session.IncomingShares(shareDraftStore,
            beforeLoad = { java.io.File(filesDir, "incoming-share-attachments").deleteRecursively() },
            onLegacyErased = { keys -> if (::authSession.isInitialized) authSession.composerDrafts.eraseMemory(keys) })
        tokenStore = TokenStore(this)
        authSession = AuthSession(this, tokenStore)
        localNotifications = ai.nuphos.android.notifications.LocalNotifications(this, { authSession.user?.id }, { authSession.aiAllowed })
        pushNotifications = ai.nuphos.android.notifications.PushNotifications(this)
        ai.nuphos.android.session.AiAccess.onRevoked = { pushNotifications.reset(clearPending = false); incomingShares.identityReset() }
        authSession.onIdentityReset = { pushNotifications.reset(); incomingShares.identityReset() }
        authSession.awaitIdentityCleanup = { incomingShares.awaitIdle() }
        authSession.beforeSessionEnd = { pushNotifications.awaitUnregistered() }
        registerActivityLifecycleCallbacks(pushNotifications)
    }
}
