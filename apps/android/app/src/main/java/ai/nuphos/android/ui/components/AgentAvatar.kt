package ai.nuphos.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChatBubbleOutline
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
import ai.nuphos.android.model.SenderAvatar
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import ai.nuphos.android.ui.theme.avatarBackground
import androidx.compose.ui.platform.LocalContext
import android.content.Context
import ai.nuphos.android.NuphosApplication
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
fun AgentAvatar(sessionId: String, runtime: String?, size: Dp = 36.dp, showBadge: Boolean = true) {
    val loader = agentImageLoader()
    val app = LocalContext.current.applicationContext as NuphosApplication
    val face = if (app.botAvatarsEnabled) ai.nuphos.android.model.BotFaces.face(sessionId) else null
    Box(Modifier.size(size).testTag("agent-identity-avatar"), contentAlignment = Alignment.Center) {
        // A face this build doesn't ship falls back to the one the ID derives, as on iOS and Desktop.
        if (face != null) {
            // Behind the character, unclipped: a head may break out of the disc.
            Box(Modifier.size(size).background(avatarBackground(ai.nuphos.android.model.BotFaces.background(sessionId)), CircleShape))
            // A photo the owner uploaded shows as-is, in a circle; until it loads, or if it fails, the derived face.
            val photo = SenderAvatar.trusted(face)
            var photoShown by remember(photo) { mutableStateOf(false) }
            if (!photoShown) AsyncImage(model = "file:///android_asset/bot-avatars/${BotAvatars.named(face) ?: BotAvatars.file(sessionId)}",
                imageLoader = loader, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.size(size))
            if (photo != null) AsyncImage(model = photo, imageLoader = loader, contentDescription = null,
                contentScale = ContentScale.Crop, onSuccess = { photoShown = true },
                modifier = Modifier.size(size).clip(CircleShape).alpha(if (photoShown) 1f else 0f).testTag("agent-photo-avatar"))
            if (showBadge && runtime != null) Box(Modifier.align(Alignment.BottomEnd)) {
                AgentRuntimeBadge(runtime, if (size <= 24.dp) 9.dp else 12.dp)
            }
        } else RuntimeMark(runtime, 20.dp, loader)
    }
}

/** One of the faces a Bot can wear, by its catalog file name. */
@Composable
fun BotFace(file: String, size: Dp, modifier: Modifier = Modifier) {
    AsyncImage(model = "file:///android_asset/bot-avatars/$file", imageLoader = agentImageLoader(), contentDescription = null,
        contentScale = ContentScale.Fit, modifier = modifier.size(size))
}

/**
 * Decorative mark; the adjacent runtime text supplies the accessible name once.
 * Until the provider is known it holds the same space empty, never a guess.
 */
@Composable
fun RuntimeMark(runtime: String?, size: Dp = 14.dp, loader: ImageLoader = agentImageLoader()) {
    val logo = RuntimeIdentity.logo(runtime)
    if (runtime == "nuphos") Icon(Icons.Outlined.ChatBubbleOutline, null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(size).testTag("runtime-provider-mark"))
    else if (logo == null) Box(Modifier.size(size))
    else AsyncImage(model = "file:///android_asset/agent-logos/$logo.svg", imageLoader = loader,
        contentDescription = null,
        colorFilter = if (RuntimeIdentity.originalColor(runtime)) null else ColorFilter.tint(MaterialTheme.colorScheme.onSurfaceVariant),
        modifier = Modifier.size(size).testTag("runtime-provider-mark"))
}

/** Decorative disc also used above overlapping group faces. */
@Composable
fun AgentRuntimeBadge(runtime: String?, size: Dp) {
    Box(Modifier.size(size).background(MaterialTheme.colorScheme.surface, CircleShape).padding(1.dp)) {
        RuntimeMark(runtime, size - 2.dp)
    }
}
