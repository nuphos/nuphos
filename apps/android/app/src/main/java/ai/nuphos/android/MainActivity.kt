package ai.nuphos.android

import android.content.Intent
import android.os.Bundle
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.currentCoroutineContext
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
    private var handledShare = false
    private val notificationPermission = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { }

    fun requestNotificationPermission() {
        val prefs = getPreferences(MODE_PRIVATE)
        if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
            prefs.getBoolean("notification_permission_asked", false)) return
        prefs.edit().putBoolean("notification_permission_asked", true).apply()
        notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
    }

    private val auth by lazy { (application as NuphosApplication).authSession }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        handledShare = savedInstanceState?.getBoolean("handled_incoming_share") == true
        if (handledShare && ai.nuphos.android.data.IncomingShareIntents.accepts(intent)) setIntent(Intent(this, MainActivity::class.java))
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
        if (!handleShareIntent(intent)) handleAuthIntent(intent)
        setContent {
            NuphosTheme {
                NuphosRoot(auth)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (!handleShareIntent(intent)) handleAuthIntent(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean("handled_incoming_share", handledShare)
        outState.putString("handled_conversation_url", handledConversationUrl)
        outState.putString("conversation_link", (application as NuphosApplication).conversationLinks.value.value?.destination?.url)
        super.onSaveInstanceState(outState)
    }

    override fun onResume() {
        super.onResume()
        handleAuthIntent(intent)
        auth.onHostResumed()
    }

    private fun handleShareIntent(intent: Intent?): Boolean {
        if (!ai.nuphos.android.data.IncomingShareIntents.accepts(intent)) return false
        handledShare = true
        val app = application as NuphosApplication
        // Capture before clearing the Activity payload; the grant remains tied to the receiving Activity.
        val captured = Intent(requireNotNull(intent))
        setIntent(Intent(this, MainActivity::class.java))
        app.incomingShareScope.launch {
            val id = try { app.incomingShares.begin(app.authSession.user?.id) }
            catch (failure: Exception) {
                if (failure is kotlinx.coroutines.CancellationException) throw failure
                android.widget.Toast.makeText(this@MainActivity, "Shared drafts are unavailable. Check storage and try again.", android.widget.Toast.LENGTH_LONG).show()
                return@launch
            }
            if (id == null) {
                android.widget.Toast.makeText(this@MainActivity, "Finish or cancel the current share before sharing another item.", android.widget.Toast.LENGTH_LONG).show()
                return@launch
            }
            val remaining = try { app.incomingShares.remainingBytes() }
            catch (failure: Exception) {
                if (failure is kotlinx.coroutines.CancellationException) throw failure
                app.incomingShares.failed(id, "Could not check saved attachment storage. Try again.")
                return@launch
            }
            var loaded = emptyList<ai.nuphos.android.model.ComposerAttachment>()
            try {
                val payload = ai.nuphos.android.data.IncomingShareIntents.read(captured)
                loaded = withContext(kotlinx.coroutines.Dispatchers.IO) {
                    val work = currentCoroutineContext()
                    fun checkCurrent() {
                        work.ensureActive()
                        if (app.incomingShares.state.value?.id != id) throw kotlinx.coroutines.CancellationException("Share canceled")
                    }
                    val inputs = payload.uris.map { checkCurrent(); ai.nuphos.android.ui.chat.selectionInput(app, it, false) }
                    if (inputs.isEmpty()) emptyList() else {
                        val retained = ai.nuphos.android.data.AttachmentRetention(app.shareDraftStore.assets, maxTotalBytes = remaining)
                            .retain(emptyList(), inputs, check = { checkCurrent() }, prepareImage = { input, bytes -> ai.nuphos.android.ui.chat.loadImage(input, bytes) })
                        try { app.incomingShares.prepare(retained, check = { checkCurrent() }) }
                        catch (failure: Throwable) { retained.forEach { it.releaseOwnedCopy() }; throw failure }
                    }
                }
                app.incomingShares.loaded(id, payload.text, loaded)
            } catch (e: Exception) {
                withContext(kotlinx.coroutines.NonCancellable + kotlinx.coroutines.Dispatchers.IO) { loaded.forEach { it.releaseOwnedCopy() } }
                if (e is kotlinx.coroutines.CancellationException) throw e
                app.incomingShares.failed(id, "Could not read this share. Check its size and permissions, then share it again.")
            } finally {
                java.lang.ref.Reference.reachabilityFence(captured)
            }
        }
        return true
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
