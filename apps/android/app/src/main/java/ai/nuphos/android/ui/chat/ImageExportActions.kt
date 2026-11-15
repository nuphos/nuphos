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
import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource

@Composable
internal fun ImageExportActions(source: String, writer: ImageOriginalWriter) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var status by remember(source) { mutableStateOf<String?>(null) }
    val preparing = stringResource(R.string.chat_image_preparing)
    val shareImage = stringResource(R.string.chat_image_share)
    val saved = stringResource(R.string.chat_image_saved)
    val exportFailed = stringResource(R.string.chat_image_export_failed)
    fun export(share: Boolean) {
        busy = true
        status = preparing
        scope.launch {
            var prepared: ExportedImage? = null
            var handedOff = false
            try {
                val image = ImageExports.prepare(context, source, writer)
                prepared = image
                ensureActive()
                if (share) {
                    context.startActivity(Intent.createChooser(ImageExports.shareIntent(context, image), shareImage))
                    handedOff = true
                    status = null
                } else {
                    ImageExports.save(context, image)
                    status = saved
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { status = exportFailed }
            finally {
                // A receiver may read after the chooser closes; retain shared copies for bounded cleanup.
                if (!handedOff) prepared?.file?.delete()
                busy = false
            }
        }
    }
    Column(Modifier.fillMaxWidth()) {
        Row {
            TextButton(enabled = !busy, onClick = { export(true) }) { Text(shareImage, color = Color.White) }
            TextButton(enabled = !busy, onClick = { export(false) }) { Text(stringResource(R.string.chat_image_save), color = Color.White) }
        }
        status?.let { Text(it, color = Color.White, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
    }
}
