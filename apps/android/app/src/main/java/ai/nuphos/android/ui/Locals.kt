package ai.nuphos.android.ui

import androidx.compose.runtime.staticCompositionLocalOf
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.session.PlansStore

val LocalAuthSession = staticCompositionLocalOf<AuthSession> {
    error("AuthSession not provided")
}

val LocalAgentStore = staticCompositionLocalOf<AgentStore> {
    error("AgentStore not provided")
}

val LocalPlansStore = staticCompositionLocalOf<PlansStore> {
    error("PlansStore not provided")
}

val LocalConnectorsStore = staticCompositionLocalOf<ai.nuphos.android.session.ConnectorsStore> {
    error("ConnectorsStore not provided")
}
