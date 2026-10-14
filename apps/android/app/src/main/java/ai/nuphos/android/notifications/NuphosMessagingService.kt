package ai.nuphos.android.notifications

import ai.nuphos.android.NuphosApplication
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class NuphosMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        (application as NuphosApplication).pushNotifications.refreshed(token)
    }
    override fun onMessageReceived(message: RemoteMessage) {
        (application as NuphosApplication).pushNotifications.receive(message.data)
    }
}
