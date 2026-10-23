package ai.nuphos.android.ui.chat

import android.content.Intent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch

@Composable
internal fun ImageExportActions(source: String, writer: ImageOriginalWriter) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var status by remember(source) { mutableStateOf<String?>(null) }
    fun export(share: Boolean) {
        busy = true
        status = "Preparing image…"
        scope.launch {
            var prepared: ExportedImage? = null
            var handedOff = false
            try {
                val image = ImageExports.prepare(context, source, writer)
                prepared = image
                ensureActive()
                if (share) {
                    context.startActivity(Intent.createChooser(ImageExports.shareIntent(context, image), "Share image"))
                    handedOff = true
                    status = null
                } else {
                    ImageExports.save(context, image)
                    status = "Saved to Pictures/Nuphos"
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { status = "Couldn't export the image. It may have expired. Try again." }
            finally {
                // A receiver may read after the chooser closes; retain shared copies for bounded cleanup.
                if (!handedOff) prepared?.file?.delete()
                busy = false
            }
        }
    }
    Column(Modifier.fillMaxWidth()) {
        Row {
            TextButton(enabled = !busy, onClick = { export(true) }) { Text("Share image", color = Color.White) }
            TextButton(enabled = !busy, onClick = { export(false) }) { Text("Save image", color = Color.White) }
        }
        status?.let { Text(it, color = Color.White, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
    }
}
