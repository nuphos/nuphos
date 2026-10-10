package ai.nuphos.android

import android.app.Application
import ai.nuphos.android.data.TokenStore
import ai.nuphos.android.session.AuthSession

class NuphosApplication : Application() {
    lateinit var localNotifications: ai.nuphos.android.notifications.LocalNotifications
        private set
    lateinit var tokenStore: TokenStore
        private set
    lateinit var authSession: AuthSession
        private set

    override fun onCreate() {
        super.onCreate()
        tokenStore = TokenStore(this)
        authSession = AuthSession(this, tokenStore)
        localNotifications = ai.nuphos.android.notifications.LocalNotifications(this, { authSession.user?.id }, { authSession.aiAllowed })
    }
}
