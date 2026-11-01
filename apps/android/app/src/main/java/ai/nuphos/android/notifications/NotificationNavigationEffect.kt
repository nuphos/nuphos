package ai.nuphos.android.notifications

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue

@Composable
internal fun NotificationNavigationEffect(pending: PendingLocalNotification, account: String?, team: String?,
    aiAllowed: Boolean, navigate: (LocalNotificationTarget) -> Unit) {
    val target by pending.value.collectAsState()
    LaunchedEffect(target, account, team, aiAllowed) {
        pending.take(account, team, aiAllowed)?.let(navigate)
    }
}
