package ai.nuphos.android.ui.chat

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** No URL fetching: conversation File parts currently contain inline data images.
 * Decode one page at a time off the main thread; thumbnails use a smaller budget.
 */
internal object MessageImageDecoder {
    private const val MAX_ENCODED = 16 * 1024 * 1024
    private val header = Regex("data:image/(png|jpeg|jpg|webp|gif);base64", RegexOption.IGNORE_CASE)

    fun decode(source: String, edge: Int): ImageBitmap? {
        if (source.length > MAX_ENCODED || edge !in 1..2048) return null
        val comma = source.indexOf(',')
        if (comma !in 1..80 || !header.matches(source.substring(0, comma))) return null
        return try {
            val bytes = Base64.decode(source.substring(comma + 1), Base64.DEFAULT)
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            if (bounds.outWidth !in 1..100_000 || bounds.outHeight !in 1..100_000) return null
            var sample = 1
            while ((bounds.outWidth.toLong() + sample - 1) / sample > edge ||
                (bounds.outHeight.toLong() + sample - 1) / sample > edge) sample *= 2
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size,
                BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
        } catch (_: IllegalArgumentException) { null }
    }
}

private val imageDecodeDispatcher = Dispatchers.Default.limitedParallelism(1)

private sealed interface ImageLoad {
    data object Loading : ImageLoad
    data object Unavailable : ImageLoad
    data class Ready(val bitmap: ImageBitmap) : ImageLoad
}

@Composable
private fun imageLoad(source: String, edge: Int): State<ImageLoad> = produceState<ImageLoad>(ImageLoad.Loading, source, edge) {
    value = ImageLoad.Loading
    value = withContext(imageDecodeDispatcher) {
        MessageImageDecoder.decode(source, edge)?.let(ImageLoad::Ready) ?: ImageLoad.Unavailable
    }
}

@Composable
internal fun MessageImages(images: List<String>, messageId: String) {
    // Save only the selected index, never duplicate base64 in saved instance state.
    var selected by rememberSaveable(messageId) { mutableIntStateOf(-1) }
    images.take(4).forEachIndexed { index, source ->
        val load by imageLoad(source, 256)
        Box(Modifier.padding(bottom = 6.dp).size(96.dp).clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .clickable(onClickLabel = "Open image ${index + 1} of ${images.size}") { selected = index },
            contentAlignment = Alignment.Center) {
            when (val result = load) {
                is ImageLoad.Ready -> Image(result.bitmap, "Image ${index + 1} of ${images.size}",
                    Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                ImageLoad.Loading -> Text("Loading image", style = MaterialTheme.typography.labelSmall)
                ImageLoad.Unavailable -> Text("Image unavailable", style = MaterialTheme.typography.labelSmall)
            }
            if (index == 3 && images.size > 4) Text("+${images.size - 4}", color = Color.White,
                modifier = Modifier.align(Alignment.BottomEnd).background(Color.Black.copy(alpha = .7f)).padding(6.dp))
        }
    }
    if (selected >= 0 && images.isNotEmpty()) {
        MessageImagePager(images, selected.coerceAtMost(images.lastIndex), { selected = it }, { selected = -1 })
    }
}

@Composable
internal fun MessageImagePager(images: List<String>, initialIndex: Int, onPage: (Int) -> Unit = {}, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        if (images.isEmpty()) {
            Surface(Modifier.fillMaxSize(), color = Color.Black, contentColor = Color.White) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Text("No images")
                    TextButton(onClick = onDismiss) { Text("Close", color = Color.White) }
                }
            }
            return@Dialog
        }
        val pager = rememberPagerState(initialPage = initialIndex.coerceIn(images.indices)) { images.size }
        val scope = rememberCoroutineScope()
        var zoomed by remember { mutableStateOf(false) }
        LaunchedEffect(pager.currentPage) { zoomed = false; onPage(pager.currentPage) }
        Column(Modifier.fillMaxSize().background(Color.Black).safeDrawingPadding()) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onDismiss) { Text("Close", color = Color.White) }
                Spacer(Modifier.weight(1f))
                Text("${pager.currentPage + 1} / ${images.size}", color = Color.White,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                Spacer(Modifier.weight(1f))
                TextButton(onClick = { zoomed = false }) { Text("Reset zoom", color = Color.White) }
            }
            HorizontalPager(pager, Modifier.weight(1f).fillMaxWidth(), userScrollEnabled = !zoomed,
                beyondViewportPageCount = 0) { page ->
                // Adjacent pages keep only placeholders, preventing multiple full-size decodes.
                if (page == pager.currentPage) {
                    key(page, images[page]) { ZoomImage(images[page], page, images.size, zoomed) { zoomed = it } }
                }
            }
            if (images.size > 1) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = { zoomed = false; scope.launch { pager.scrollToPage((pager.currentPage - 1 + images.size) % images.size) } }) {
                    Text("Previous image", color = Color.White)
                }
                TextButton(onClick = { zoomed = false; scope.launch { pager.scrollToPage((pager.currentPage + 1) % images.size) } }) {
                    Text("Next image", color = Color.White)
                }
            }
        }
    }
}

@Composable
private fun ZoomImage(source: String, index: Int, count: Int, zoomed: Boolean, onZoom: (Boolean) -> Unit) {
    val load by imageLoad(source, 2048)
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var size by remember { mutableStateOf(IntSize.Zero) }
    LaunchedEffect(zoomed) { if (!zoomed) { scale = 1f; offset = Offset.Zero } }
    LaunchedEffect(size) { scale = 1f; offset = Offset.Zero; onZoom(false) }
    fun bounded(candidate: Offset, zoom: Float): Offset {
        val bitmap = (load as? ImageLoad.Ready)?.bitmap ?: return Offset.Zero
        val fit = minOf(size.width.toFloat() / bitmap.width, size.height.toFloat() / bitmap.height)
        val x = ((bitmap.width * fit * zoom - size.width) / 2).coerceAtLeast(0f)
        val y = ((bitmap.height * fit * zoom - size.height) / 2).coerceAtLeast(0f)
        return Offset(candidate.x.coerceIn(-x, x), candidate.y.coerceIn(-y, y))
    }
    val transform = rememberTransformableState { zoom, pan, _ ->
        scale = (scale * zoom).coerceIn(1f, 4f)
        offset = bounded(offset + pan, scale)
        onZoom(scale > 1.01f)
    }
    Box(Modifier.fillMaxSize().clip(RoundedCornerShape(0.dp)).onSizeChanged { size = it }
        .transformable(transform, canPan = { scale > 1.01f })
        .pointerInput(source) { detectTapGestures(onDoubleTap = {
            scale = if (scale > 1.01f) 1f else 2f
            offset = Offset.Zero
            onZoom(scale > 1.01f)
        }) }
        .semantics {
            contentDescription = "Image ${index + 1} of $count"
            stateDescription = "${(scale * 100).toInt()} percent zoom"
            customActions = listOf(
                CustomAccessibilityAction("Zoom in") { scale = (scale + 1f).coerceAtMost(4f); onZoom(true); true },
                CustomAccessibilityAction("Reset zoom") { scale = 1f; offset = Offset.Zero; onZoom(false); true },
            )
        }, contentAlignment = Alignment.Center) {
        when (val result = load) {
            is ImageLoad.Ready -> Image(result.bitmap, null, Modifier.fillMaxSize().graphicsLayer {
                scaleX = scale; scaleY = scale; translationX = offset.x; translationY = offset.y
            }, contentScale = ContentScale.Fit)
            ImageLoad.Loading -> Text("Loading image", color = Color.White)
            ImageLoad.Unavailable -> Text("Image unavailable", color = Color.White)
        }
    }
}
