package ai.nuphos.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
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

/** A conversation has its own stable identity, independent of its owner. */
@Composable
fun AgentAvatar(sessionId: String, runtime: String?, size: Dp = 36.dp) {
    val loader = agentImageLoader()
    Box(Modifier.size(size)) {
        AsyncImage(model = "file:///android_asset/bot-avatars/${BotAvatars.file(sessionId)}",
            imageLoader = loader, contentDescription = null, contentScale = ContentScale.Fit,
            modifier = Modifier.size(size))
        Box(Modifier.align(Alignment.BottomEnd).background(MaterialTheme.colorScheme.background, CircleShape).padding(1.dp)) {
            RuntimeMark(runtime, if (size <= 24.dp) 9.dp else 12.dp, loader)
        }
    }
}

@Composable
fun RuntimeMark(runtime: String?, size: Dp = 12.dp, loader: ImageLoader = agentImageLoader()) {
    val logo = when (runtime) {
        "codex" -> "openai"
        "claude-code" -> "claude"
        "grok" -> "grok"
        "opencode" -> "opencode"
        "antigravity" -> "antigravity"
        else -> null
    }
    if (logo == null) Icon(Icons.Outlined.ChatBubbleOutline, runtime ?: "Nuphos",
        tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(size))
    else AsyncImage(model = "file:///android_asset/agent-logos/$logo.svg", imageLoader = loader,
        contentDescription = when (runtime) { "claude-code" -> "Claude Code"; "codex" -> "Codex"; else -> runtime },
        colorFilter = if (runtime == "claude-code" || runtime == "antigravity") null else ColorFilter.tint(MaterialTheme.colorScheme.onSurfaceVariant),
        modifier = Modifier.size(size))
}
