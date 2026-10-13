package ai.nuphos.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import ai.nuphos.android.ui.NuphosRoot
import ai.nuphos.android.ui.theme.NuphosTheme
import coil3.ImageLoader
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import okhttp3.OkHttpClient

class MainActivity : ComponentActivity() {
    private var handledConversationUrl: String? = null
    private val notificationPermission = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { }

    fun requestNotificationPermission() { notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS) }

    private val auth by lazy { (application as NuphosApplication).authSession }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        handledConversationUrl = savedInstanceState?.getString("handled_conversation_url")
        if (handledConversationUrl != null && intent?.data?.toString() == handledConversationUrl) {
            setIntent(Intent(intent).also { it.data = null })
        }
        (application as NuphosApplication).conversationLinks.restore(savedInstanceState?.getString("conversation_link"))
        SingletonImageLoader.setSafe { context ->
            ImageLoader.Builder(context)
                .components { add(OkHttpNetworkFetcherFactory(OkHttpClient())) }
                .crossfade(true)
                .build()
        }
        handleAuthIntent(intent)
        setContent {
            NuphosTheme {
                NuphosRoot(auth)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleAuthIntent(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("handled_conversation_url", handledConversationUrl)
        outState.putString("conversation_link", (application as NuphosApplication).conversationLinks.value.value?.destination?.url)
        super.onSaveInstanceState(outState)
    }

    override fun onResume() {
        super.onResume()
        handleAuthIntent(intent)
        auth.onHostResumed()
    }

    private fun handleAuthIntent(intent: Intent?) {
        if (intent != null && (application as NuphosApplication).localNotifications.accept(intent)) {
            setIntent(Intent(intent).also { it.action = null; it.data = null; it.replaceExtras(null as Bundle?) })
            return
        }
        val data = intent?.data ?: return
        if (intent.action == Intent.ACTION_VIEW) {
            val destination = ai.nuphos.android.session.ConversationLink.parse(data.toString())
            if (destination != null) {
                handledConversationUrl = data.toString()
                (application as NuphosApplication).conversationLinks.offer(destination)
                setIntent(Intent(intent).also { it.data = null })
                return
            }
        }
        if (ai.nuphos.android.session.ConnectorIntents.dispatch(data.toString()) || auth.handleCallback(data)) {
            setIntent(Intent(intent).also { it.data = null })
        }
    }
}
