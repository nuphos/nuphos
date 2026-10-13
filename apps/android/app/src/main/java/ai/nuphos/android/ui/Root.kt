package ai.nuphos.android.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import ai.nuphos.android.ui.profile.ConsentScreen
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import ai.nuphos.android.data.ConnectorApi
import ai.nuphos.android.data.ConnectorPendingPreferences
import ai.nuphos.android.session.ConnectorsStore
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.session.PlansStore
import ai.nuphos.android.ui.home.HomeRoute
import ai.nuphos.android.ui.login.LoginScreen
import ai.nuphos.android.ui.login.SplashScreen

@Composable
fun NuphosRoot(auth: AuthSession) {
    LaunchedEffect(Unit) { auth.restore() }
    val notifications = (LocalContext.current.applicationContext as ai.nuphos.android.NuphosApplication).localNotifications
    LaunchedEffect(auth.state) {
        notifications.onIdentity(auth.user?.id, auth.state is AuthSession.State.SignedOut)
    }
    CompositionLocalProvider(LocalAuthSession provides auth) {
        Surface(Modifier.fillMaxSize()) {
            AnimatedContent(
                targetState = when (auth.state) {
                    AuthSession.State.Restoring -> "restoring"
                    is AuthSession.State.SignedOut, AuthSession.State.SigningIn -> "login"
                    is AuthSession.State.SignedIn -> if (auth.aiAllowed) "home" else "consent"
                },
                transitionSpec = { fadeIn() togetherWith fadeOut() },
                label = "auth",
            ) { key ->
                when (key) {
                    "restoring" -> SplashScreen()
                    "login" -> LoginScreen()
                    else -> {
                        val user = (auth.state as? AuthSession.State.SignedIn)?.user
                        if (user != null && key == "home" && auth.aiAllowed) SignedInHost(user, auth.token.orEmpty())
                        else if (user != null) ConsentScreen(user)
                        else LoginScreen()
                    }
                }
            }
        }
    }
}

@Composable
internal fun SignedInHost(user: NuphosUser, token: String, agentFactory: (String, android.content.Context) -> AgentStore = ::AgentStore) {
    val context = LocalContext.current.applicationContext
    val agent = remember(token, AiAccess.revision) { agentFactory(token, context) }
    val plans = remember(token) { PlansStore(token) }
    val connectors = remember(token, user.id) { ConnectorsStore(ConnectorApi(token), ConnectorPendingPreferences(context, user.id)) }
    HomeRoute(user, agent, plans, connectors)
}
