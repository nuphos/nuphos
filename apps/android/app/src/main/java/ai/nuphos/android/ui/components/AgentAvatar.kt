package ai.nuphos.android.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Memory
import ai.nuphos.android.model.RuntimeIdentity
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.testTag
import ai.nuphos.android.model.BotAvatars
import androidx.compose.ui.platform.LocalContext
import android.content.Context
import coil3.svg.SvgDecoder
import coil3.ImageLoader
import coil3.compose.AsyncImage

/** One application cache for local SVG assets, shared across lazy rows and badges. */
private object AgentImages {
    @Volatile private var loader: ImageLoader? = null
    fun get(context: Context): ImageLoader = loader ?: synchronized(this) {
        loader ?: ImageLoader.Builder(context.applicationContext)
            .components { add(SvgDecoder.Factory()) }.build().also { loader = it }
    }
}

@Composable
private fun agentImageLoader(): ImageLoader = AgentImages.get(LocalContext.current)

/** A Bot wears its face; a Task, or a Bot not seen yet, shows its runtime mark. */
@Composable
fun AgentAvatar(sessionId: String, runtime: String?, size: Dp = 36.dp) {
    val loader = agentImageLoader()
    val face = ai.nuphos.android.model.BotFaces.face(sessionId).takeIf { botAvatarsEnabled() }
    Box(Modifier.size(size).testTag("agent-identity-avatar"), contentAlignment = Alignment.Center) {
        // A face this build doesn't ship falls back to the one the ID derives, as on iOS and Desktop.
        if (face != null) AsyncImage(model = "file:///android_asset/bot-avatars/${BotAvatars.named(face) ?: BotAvatars.file(sessionId)}",
            imageLoader = loader, contentDescription = null, contentScale = ContentScale.Fit,
            modifier = Modifier.size(size))
        else RuntimeMark(runtime, 20.dp, loader)
    }
}

/** One of the faces a Bot can wear, by its catalog file name. */
@Composable
fun BotFace(file: String, size: Dp, modifier: Modifier = Modifier) {
    AsyncImage(model = "file:///android_asset/bot-avatars/$file", imageLoader = agentImageLoader(), contentDescription = null,
        contentScale = ContentScale.Fit, modifier = modifier.size(size))
}

/** Decorative mark; the adjacent runtime text supplies the accessible name once. */
@Composable
fun RuntimeMark(runtime: String?, size: Dp = 14.dp, loader: ImageLoader = agentImageLoader()) {
    val logo = RuntimeIdentity.logo(runtime)
    if (logo == null) Icon(if (runtime == "nuphos") Icons.Outlined.ChatBubbleOutline else Icons.Outlined.Memory, null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(size).testTag("runtime-provider-mark"))
    else AsyncImage(model = "file:///android_asset/agent-logos/$logo.svg", imageLoader = loader,
        contentDescription = null,
        colorFilter = if (RuntimeIdentity.originalColor(runtime)) null else ColorFilter.tint(MaterialTheme.colorScheme.onSurfaceVariant),
        modifier = Modifier.size(size).testTag("runtime-provider-mark"))
}

/** Read the same observable preference as Account > Appearance. */
@Composable
fun botAvatarsEnabled(): Boolean {
    val context = LocalContext.current
    return androidx.compose.runtime.remember(context) { ai.nuphos.android.model.BotAvatarPreferences.get(context) }.enabled
}
