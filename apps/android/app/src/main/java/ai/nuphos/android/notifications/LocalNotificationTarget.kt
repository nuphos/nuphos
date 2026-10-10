package ai.nuphos.android.notifications

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Notification identifiers are untrusted input; they never authorize access. */
data class LocalNotificationTarget(val accountId: String, val teamId: String, val sessionId: String) {
    companion object {
        fun from(account: String?, team: String?, session: String?): LocalNotificationTarget? {
            val id = Regex("[A-Za-z0-9_-]{1,128}")
            if (listOf(account, team, session).any { it == null || !id.matches(it) }) return null
            return LocalNotificationTarget(account!!, team!!, session!!)
        }
    }
}

class PendingLocalNotification {
    private val mutable = MutableStateFlow<LocalNotificationTarget?>(null)
    val value = mutable.asStateFlow()
    fun offer(target: LocalNotificationTarget) { mutable.value = target }
    fun clear() { mutable.value = null }
    fun take(account: String?, team: String?, aiAllowed: Boolean): LocalNotificationTarget? {
        val target = mutable.value ?: return null
        if (account == null || team == null) return null
        clear()
        return target.takeIf { aiAllowed && it.accountId == account && it.teamId == team }
    }
}
