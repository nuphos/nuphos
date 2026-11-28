package ai.nuphos.android.ui.chat

import android.annotation.SuppressLint
import android.content.Intent
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import ai.nuphos.android.R
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.ToolCard
import ai.nuphos.android.ui.components.MarkdownText

/** An artifact or chart in the chat. Opening one fills the screen, the phone's side panel. */
@Composable
fun ToolCardView(card: ToolCard) {
    var open by remember { mutableStateOf(false) }
    Surface(onClick = { open = true }, shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainerLow,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.widthIn(max = 520.dp).fillMaxWidth().testTag(if (card is ToolCard.Chart) "chart-card" else "artifact-card")) {
        when (card) {
            is ToolCard.Artifact -> Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(card.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 2)
                    Text(kindLabel(card.kind), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                OpenBadge()
            }
            is ToolCard.Chart -> Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f)) {
                        Text(card.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 2)
                        card.description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2) }
                    }
                    OpenBadge()
                }
                ChartBody(card, Modifier.fillMaxWidth().height(180.dp))
            }
        }
    }
    if (open) ToolCardPanel(card) { open = false }
}

@Composable
private fun OpenBadge() {
    Surface(shape = MaterialTheme.shapes.small, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), color = Color.Transparent) {
        Row(Modifier.padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stringResource(R.string.tool_card_open), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, Modifier.size(12.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun kindLabel(kind: String) = when (kind) {
    "html" -> "HTML"
    "svg" -> "SVG"
    "markdown" -> stringResource(R.string.tool_card_document)
    else -> stringResource(R.string.tool_card_code)
}

/** The card opened over the chat. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ToolCardPanel(card: ToolCard, onClose: () -> Unit) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize().testTag("tool-card-panel")) {
            Column(Modifier.fillMaxSize().systemBarsPadding()) {
                TopAppBar(
                    title = { Text(if (card is ToolCard.Artifact) card.title else (card as ToolCard.Chart).title, maxLines = 1) },
                    navigationIcon = {
                        IconButton(onClick = onClose, modifier = Modifier.testTag("tool-card-close")) {
                            Icon(Icons.Outlined.Close, stringResource(R.string.shell_close))
                        }
                    },
                )
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    when (card) {
                        is ToolCard.Artifact -> when (card.kind) {
                            "html" -> ArtifactPage(card.content)
                            "svg" -> ArtifactPage("<body style=\"margin:0\">${card.content}</body>")
                            "markdown" -> Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) { MarkdownText(card.content) }
                            else -> SelectionContainer {
                                Text(card.content, Modifier.verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).padding(16.dp),
                                    fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                        is ToolCard.Chart -> Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            card.description?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            ChartBody(card, Modifier.fillMaxWidth().weight(1f))
                        }
                    }
                }
            }
        }
    }
}

/**
 * An artifact's page: its scripts run so it draws, with no file access and no bridge to the
 * app. A link leaves for the browser instead of replacing the page.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun ArtifactPage(html: String) {
    AndroidView(modifier = Modifier.fillMaxSize().testTag("artifact-page"), factory = { context ->
        WebView(context).apply {
            settings.javaScriptEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val url = request.url
                    if (url.scheme?.lowercase() in setOf("http", "https", "mailto"))
                        runCatching { view.context.startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                    return true
                }
            }
            val viewport = if (Regex("<meta[^>]*name\\s*=\\s*[\"']?viewport", RegexOption.IGNORE_CASE).containsMatchIn(html)) ""
                else "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            loadDataWithBaseURL(null, "<meta charset=\"utf-8\">$viewport$html", "text/html", "utf-8", null)
        }
    }, onRelease = { it.destroy() })
}

/** Bars side by side per series, or a line or area per series, on a shared scale from zero. */
@Composable
private fun ChartBody(chart: ToolCard.Chart, modifier: Modifier) {
    val measurer = rememberTextMeasurer()
    val scheme = MaterialTheme.colorScheme
    val palette = listOf(scheme.primary, scheme.tertiary, scheme.secondary, scheme.error)
    val labelStyle = TextStyle(fontSize = 11.sp, color = scheme.onSurfaceVariant)
    val grid = scheme.outlineVariant
    val values = chart.rows.map { row -> chart.series.map { (key, _) -> row[key]?.numberValue } }
    val max = values.flatten().filterNotNull().maxOrNull()?.takeIf { it > 0 } ?: 1.0
    val labels = chart.rows.map { row -> row[chart.xKey]?.let(::axisText).orEmpty() }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Canvas(Modifier.fillMaxWidth().weight(1f)) {
            val axis = 18.dp.toPx()
            val plot = Size(size.width, size.height - axis)
            listOf(0.0, 0.5, 1.0).forEach { f ->
                val y = plot.height * (1 - f).toFloat()
                drawLine(grid, Offset(0f, y), Offset(plot.width, y), 1f)
            }
            val slot = plot.width / chart.rows.size
            fun y(v: Double) = plot.height * (1 - v / max).toFloat()
            if (chart.type == "line" || chart.type == "area") {
                chart.series.indices.forEach { s ->
                    val points = values.mapIndexedNotNull { i, row -> row[s]?.let { Offset(slot * (i + 0.5f), y(it)) } }
                    if (points.isEmpty()) return@forEach
                    val color = palette[s % palette.size]
                    val line = Path().apply { points.forEachIndexed { i, p -> if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y) } }
                    if (chart.type == "area") drawPath(Path().apply {
                        addPath(line); lineTo(points.last().x, plot.height); lineTo(points.first().x, plot.height); close()
                    }, color.copy(alpha = 0.25f))
                    drawPath(line, color, style = Stroke(2.dp.toPx()))
                }
            } else {
                val bar = slot * 0.7f / chart.series.size
                values.forEachIndexed { i, row ->
                    row.forEachIndexed { s, v ->
                        if (v == null) return@forEachIndexed
                        val x = slot * i + slot * 0.15f + bar * s
                        drawRect(palette[s % palette.size], Offset(x, y(v)), Size(bar - 2f, plot.height - y(v)))
                    }
                }
            }
            labels.forEachIndexed { i, label ->
                val text = measurer.measure(label, labelStyle, maxLines = 1)
                drawText(text, topLeft = Offset(slot * (i + 0.5f) - text.size.width / 2f, plot.height + 4f))
            }
        }
        if (chart.series.size > 1) Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            chart.series.forEachIndexed { s, (_, label) ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Canvas(Modifier.size(8.dp)) { drawCircle(palette[s % palette.size]) }
                    Text(label, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

private fun axisText(value: JsonValue): String = when (value) {
    is JsonValue.Str -> value.value
    is JsonValue.Number -> if (value.value % 1.0 == 0.0) value.value.toLong().toString() else value.value.toString()
    is JsonValue.Bool -> value.value.toString()
    else -> ""
}
