package ai.nuphos.android.ui.components

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.times
import androidx.compose.ui.unit.sp
import com.mikepenz.markdown.coil3.Coil3ImageTransformerImpl
import com.mikepenz.markdown.compose.LocalMarkdownDimens
import com.mikepenz.markdown.compose.components.MarkdownComponentModel
import com.mikepenz.markdown.compose.components.MarkdownComponents
import com.mikepenz.markdown.compose.components.markdownComponents
import com.mikepenz.markdown.compose.elements.MarkdownTable
import com.mikepenz.markdown.compose.elements.MarkdownTableHeader
import com.mikepenz.markdown.compose.elements.MarkdownTableRow
import com.mikepenz.markdown.m3.elements.MarkdownCheckBox
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import com.mikepenz.markdown.model.MarkdownAnimations
import com.mikepenz.markdown.model.MarkdownColors
import com.mikepenz.markdown.model.MarkdownTypography
import com.mikepenz.markdown.model.markdownAnimations
import com.mikepenz.markdown.model.rememberMarkdownState
import com.mikepenz.markdown.model.rememberStreamingMarkdownState
import java.net.URI
import org.intellij.markdown.ast.findChildOfType
import org.intellij.markdown.flavours.gfm.GFMElementTypes.HEADER
import org.intellij.markdown.flavours.gfm.GFMTokenTypes.CELL

@Composable
fun MarkdownText(
    text: String,
    modifier: Modifier = Modifier,
    streaming: Boolean = false,
    onLink: ((String) -> Unit)? = null,
) {
    val fallbackHandler = LocalUriHandler.current
    val uriHandler = remember(onLink, fallbackHandler) {
        object : UriHandler {
            override fun openUri(uri: String) {
                if (onLink != null) onLink(uri) else fallbackHandler.openUri(uri)
            }
        }
    }
    val streamLatch = remember { mutableStateOf(streaming) }
    SideEffect {
        if (streaming) streamLatch.value = true
    }

    CompositionLocalProvider(LocalUriHandler provides uriHandler) {
        val documentModifier = modifier.fillMaxWidth()
        if (streamLatch.value) {
            StreamingMarkdownDocument(text, documentModifier)
        } else {
            StaticMarkdownDocument(text, documentModifier)
        }
    }
}

@Composable
private fun StreamingMarkdownDocument(text: String, modifier: Modifier) {
    var generation by remember { mutableIntStateOf(0) }
    val latestText by rememberUpdatedState(text)
    key(generation) {
        val state = rememberStreamingMarkdownState()
        LaunchedEffect(state) {
            var applied = ""
            snapshotFlow { latestText }.collect { latest ->
                when (val update = markdownStreamUpdate(applied, latest)) {
                    MarkdownStreamUpdate.None -> Unit
                    is MarkdownStreamUpdate.Append -> {
                        state.append(update.chunk)
                        applied = latest
                    }
                    MarkdownStreamUpdate.Restart -> generation++
                }
            }
        }
        NuphosMarkdown {
            Markdown(
                streamingMarkdownState = state,
                modifier = modifier,
                colors = it.colors,
                typography = it.typography,
                imageTransformer = Coil3ImageTransformerImpl,
                animations = it.animations,
                components = it.components,
            )
        }
    }
}

@Composable
private fun StaticMarkdownDocument(text: String, modifier: Modifier) {
    val markdownState = rememberMarkdownState(text, retainState = true)
    NuphosMarkdown {
        Markdown(
            markdownState = markdownState,
            modifier = modifier,
            colors = it.colors,
            typography = it.typography,
            imageTransformer = Coil3ImageTransformerImpl,
            animations = it.animations,
            components = it.components,
            loading = {},
        )
    }
}

private class MarkdownChrome(
    val colors: MarkdownColors,
    val typography: MarkdownTypography,
    val animations: MarkdownAnimations,
    val components: MarkdownComponents,
)

@Composable
private fun NuphosMarkdown(content: @Composable (MarkdownChrome) -> Unit) {
    val body = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp, lineHeight = 22.sp)
    val colors = markdownColor(text = MaterialTheme.colorScheme.onSurface)
    val typography = markdownTypography(
        h1 = body.copy(fontSize = 18.sp, lineHeight = 24.sp, fontWeight = FontWeight.Bold),
        h2 = body.copy(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
        h3 = body.copy(fontWeight = FontWeight.SemiBold),
        h4 = body.copy(fontWeight = FontWeight.Medium),
        h5 = body.copy(fontSize = 14.sp, fontWeight = FontWeight.Medium),
        h6 = body.copy(fontSize = 13.sp, fontWeight = FontWeight.Medium),
        text = body,
        paragraph = body,
        ordered = body,
        bullet = body,
        list = body,
        quote = body.copy(fontStyle = FontStyle.Italic),
        code = body.copy(fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 18.sp),
        inlineCode = body.copy(fontFamily = FontFamily.Monospace, fontSize = 13.5.sp),
        table = body,
        alertTitle = body.copy(fontWeight = FontWeight.Bold),
        textLink = TextLinkStyles(
            style = body.copy(
                color = MaterialTheme.colorScheme.primary,
                textDecoration = TextDecoration.Underline,
            ).toSpanStyle(),
        ),
    )
    val animations = markdownAnimations(animateTextSize = { this })
    val components = markdownComponents(
        checkbox = { MarkdownCheckBox(it.content, it.node, it.typography.text) },
        table = { NuphosMarkdownTable(it) },
    )
    content(MarkdownChrome(colors, typography, animations, components))
}

@Composable
private fun NuphosMarkdownTable(model: MarkdownComponentModel) {
    val dimens = LocalMarkdownDimens.current
    val columns = model.node.findChildOfType(HEADER)?.children?.count { it.type == CELL } ?: 0
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val availableWidth = maxWidth
        Column {
            if (columns * dimens.tableCellWidth > availableWidth) {
                Text(
                    "Swipe horizontally to see more columns",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 4.dp),
                )
            }
            MarkdownTable(
                content = model.content,
                node = model.node,
                style = model.typography.table,
                headerBlock = { content, node, width, style ->
                    MarkdownTableHeader(content, node, width, style, maxLines = Int.MAX_VALUE, overflow = TextOverflow.Clip)
                },
                rowBlock = { content, node, width, style ->
                    MarkdownTableRow(content, node, width, style, maxLines = Int.MAX_VALUE, overflow = TextOverflow.Clip)
                },
            )
        }
    }
}

internal sealed class MarkdownStreamUpdate {
    data object None : MarkdownStreamUpdate()
    data class Append(val chunk: String) : MarkdownStreamUpdate()
    data object Restart : MarkdownStreamUpdate()
}

internal fun markdownStreamUpdate(applied: String, latest: String): MarkdownStreamUpdate = when {
    latest == applied -> MarkdownStreamUpdate.None
    latest.startsWith(applied) -> MarkdownStreamUpdate.Append(latest.substring(applied.length))
    else -> MarkdownStreamUpdate.Restart
}

fun looksLikeUri(value: String): Boolean = runCatching { URI(value).scheme != null }.getOrDefault(false)
