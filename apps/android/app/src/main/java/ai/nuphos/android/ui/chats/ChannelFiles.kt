package ai.nuphos.android.ui.chats

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.nuphos.android.data.TransferDownloadFile
import ai.nuphos.android.data.TransferDownloadGroup
import ai.nuphos.android.data.TransferDownloads
import ai.nuphos.android.model.TransferUpload
import ai.nuphos.android.ui.chat.ImageLoad
import ai.nuphos.android.ui.chat.MessageImageDecoder
import ai.nuphos.android.ui.chat.MessageImageLoader
import ai.nuphos.android.ui.chat.MessageImagePager
import ai.nuphos.android.ui.chat.imageLoad
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/** One file of a post, with the group it came from: each group keeps its own fresh links. */
internal data class PostFile(val groupId: String, val file: TransferDownloadFile) {
    /** The pager's and loader's handle for this file. */
    val key: String get() = "$groupId/${file.id}"
}

/** What a post's groups show, in posting order: one grid of images and videos, then other files. */
internal data class PostFiles(val media: List<PostFile>, val others: List<PostFile>) {
    val images: List<PostFile> get() = media.filter { it.file.isImage }
    /** A single image shows whole; anything more is a grid of squares. */
    val lone: PostFile? get() = media.singleOrNull()?.takeIf { it.file.isImage }

    companion object {
        fun of(groups: List<String>, loaded: Map<String, List<TransferDownloadFile>>): PostFiles {
            val files = groups.flatMap { group -> loaded[group].orEmpty().map { PostFile(group, it) } }
            val media = files.filter { it.file.isImage || it.file.isVideo }
            return PostFiles(media, files - media.toSet())
        }
    }
}

private val TILE = 84.dp
private val GAP = 6.dp
private val LONE = 260.dp

/**
 * A post's file groups drawn as one, as on iOS: images and videos share one grid of squares and
 * one pager across every group; other files are chips below. A group that can't be read drops out
 * and can be retried; only when none can be read do the file names show instead.
 */
@Composable
internal fun ChannelFiles(
    groups: List<TransferUpload>,
    mine: Boolean,
    loadGroup: suspend (String) -> TransferDownloadGroup,
    allowed: () -> Boolean,
    downloads: TransferDownloads,
) {
    if (groups.isEmpty()) return
    val ids = groups.map { it.groupId }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val directory = remember(ids) { File.createTempFile("transfer-", "", context.cacheDir).apply { delete(); mkdirs() } }
    val cached = remember(directory) { ConcurrentHashMap<String, File>() }
    DisposableEffect(directory) { onDispose { directory.deleteRecursively() } }
    val latestAllowed by rememberUpdatedState(allowed)
    val latestLoad by rememberUpdatedState(loadGroup)
    var loaded by remember(ids) { mutableStateOf<Map<String, List<TransferDownloadFile>>>(emptyMap()) }
    var missing by remember(ids) { mutableStateOf<Set<String>>(emptySet()) }
    var loading by remember(ids) { mutableStateOf(true) }
    var retry by remember { mutableIntStateOf(0) }
    var failed by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf<String?>(null) }
    var pendingSave by remember { mutableStateOf<File?>(null) }
    var pager by remember(ids) { mutableIntStateOf(-1) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val file = pendingSave
        pendingSave = null
        if (file != null) scope.launch {
            try {
                if (uri != null && latestAllowed()) withContext(Dispatchers.IO) {
                    context.contentResolver.openOutputStream(uri)?.use { output ->
                        file.inputStream().use { input ->
                            val buffer = ByteArray(8192)
                            while (true) {
                                ensureActive()
                                check(latestAllowed())
                                val count = input.read(buffer)
                                if (count < 0) break
                                output.write(buffer, 0, count)
                            }
                        }
                    } ?: error("Save unavailable")
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { failed = true }
            finally { file.delete() }
        }
    }
    // Each group is read on its own, so one that is gone never hides the others.
    LaunchedEffect(ids, retry) {
        loading = true
        val read = mutableMapOf<String, List<TransferDownloadFile>>()
        val gone = mutableSetOf<String>()
        for (id in ids) {
            try {
                val group = latestLoad(id)
                check(latestAllowed())
                read[id] = group.readyFiles(id)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { gone += id }
        }
        loaded = read; missing = gone; loading = false
    }
    suspend fun fresh(file: PostFile): TransferDownloadFile {
        check(latestAllowed())
        val remote = latestLoad(file.groupId).readyFiles(file.groupId).single { it.id == file.file.id }
        check(latestAllowed())
        return remote
    }
    val files = PostFiles.of(ids, loaded)
    val byKey = (files.media + files.others).associateBy { it.key }
    val loader: MessageImageLoader = remember(directory, retry, downloads, byKey.keys) {
        { key, edge ->
            try {
                val file = byKey[key] ?: error("Unknown file")
                val local = cached[key]?.takeIf { it.isFile } ?: run {
                    val remote = fresh(file)
                    withContext(Dispatchers.IO) {
                        val target = File.createTempFile("image-", ".preview", directory)
                        try {
                            target.outputStream().use { downloads.copy(remote, it) { latestAllowed() } }
                            cached[key] = target
                            target
                        } catch (error: Exception) { target.delete(); throw error }
                    }
                }
                check(latestAllowed())
                MessageImageDecoder.decodeFile(local, edge)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { null }
        }
    }
    fun download(file: PostFile) {
        busy = file.key
        failed = false
        scope.launch {
            var local: File? = null
            try {
                val remote = fresh(file)
                val destination = withContext(Dispatchers.IO) { File.createTempFile("save-", ".download", directory) }
                local = destination
                withContext(Dispatchers.IO) { destination.outputStream().use { downloads.copy(remote, it) { latestAllowed() } } }
                check(latestAllowed())
                pendingSave = local
                save.launch(file.file.safeName)
                local = null
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { failed = true }
            finally { local?.delete(); busy = null }
        }
    }
    val idle = busy == null && pendingSave == null
    Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start, verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.testTag("channel-files")) {
        val lone = files.lone
        if (lone != null) LoneImage(lone, loader, mine) { pager = 0 }
        else if (files.media.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(GAP)) {
                files.media.chunked(3).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(GAP)) {
                        row.forEach { file ->
                            Tile(file, loader, busy == file.key) {
                                // A video opens in the viewer with the post's images, as on iOS.
                                pager = files.media.indexOf(file)
                            }
                        }
                    }
                }
            }
        }
        files.others.forEach { file -> Chip(file.file.fileName, busy == file.key, enabled = idle) { download(file) } }
        // None could be read: the names the post carried, as iOS shows them.
        if (!loading && loaded.values.all { it.isEmpty() } && missing.isNotEmpty())
            groups.flatMap { it.names }.forEach { Chip(it, busy = false, enabled = false) {} }
        if (failed) Text("Couldn't save the file. Try again.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        if (!loading && missing.isNotEmpty()) TextButton(enabled = idle, onClick = { failed = false; retry++ }) { Text("Retry attachments") }
    }
    if (pager >= 0 && files.media.isNotEmpty()) {
        val media = files.media.map { it.key }
        MessageImagePager(media, pager.coerceAtMost(media.lastIndex), loader = loader,
            videos = files.media.filter { it.file.isVideo }.map { it.key }.toSet(),
            videoLoader = { key ->
                try {
                    val file = byKey[key] ?: error("Unknown file")
                    cached[key]?.takeIf { it.isFile } ?: run {
                        val remote = fresh(file)
                        withContext(Dispatchers.IO) {
                            val target = File.createTempFile("video-", ".${file.file.fileName.substringAfterLast('.', "mp4")}", directory)
                            try {
                                target.outputStream().use { downloads.copy(remote, it) { latestAllowed() } }
                                cached[key] = target
                                target
                            } catch (error: Exception) { target.delete(); throw error }
                        }
                    }.takeIf { latestAllowed() }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { null }
            },
            onSaveVideo = { key -> byKey[key]?.let { if (idle) download(it) } },
            originalWriter = { key, destination ->
                val file = byKey[key] ?: error("Unknown file")
                val remote = fresh(file)
                destination.outputStream().use { downloads.copy(remote, it) { latestAllowed() } }
                check(latestAllowed())
                remote.safeName
            }, onDismiss = { pager = -1 })
    }
}

@Composable
private fun LoneImage(file: PostFile, loader: MessageImageLoader, mine: Boolean, onOpen: () -> Unit) {
    val load by imageLoad(file.key, 1024, loader)
    val shape = RoundedCornerShape(12.dp)
    // The frame takes the image's shape, with its longer side at LONE, so there's no empty band around a wide one.
    Box(Modifier.widthIn(max = LONE), contentAlignment = if (mine) Alignment.CenterEnd else Alignment.CenterStart) {
        val open = Modifier.clip(shape).border(1.dp, MaterialTheme.colorScheme.surfaceContainerHigh, shape)
            .clickable(onClickLabel = "Open ${file.file.fileName}", onClick = onOpen)
        when (val result = load) {
            is ImageLoad.Ready -> {
                val ratio = result.bitmap.width.toFloat() / result.bitmap.height.coerceAtLeast(1)
                Image(result.bitmap, file.file.fileName, open.then(
                    if (ratio >= 1f) Modifier.width(LONE).aspectRatio(ratio) else Modifier.height(LONE).aspectRatio(ratio)),
                    contentScale = ContentScale.Fit)
            }
            else -> Box(open.size(LONE * 0.75f, LONE).background(MaterialTheme.colorScheme.surfaceContainerHigh))
        }
    }
}

@Composable
private fun Tile(file: PostFile, loader: MessageImageLoader, busy: Boolean, onOpen: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Box(Modifier.size(TILE).clip(shape).background(if (file.file.isVideo) Color.Black else MaterialTheme.colorScheme.surfaceContainerHigh)
        .border(1.dp, MaterialTheme.colorScheme.surfaceContainerHigh, shape)
        .clickable(onClickLabel = "Open ${file.file.fileName}", onClick = onOpen)
        .semantics { contentDescription = file.file.fileName }, contentAlignment = Alignment.Center) {
        if (file.file.isImage) {
            val load by imageLoad(file.key, 256, loader)
            (load as? ImageLoad.Ready)?.let { Image(it.bitmap, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
        }
        if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
        else if (file.file.isVideo) Box(Modifier.size(28.dp).background(Color.Black.copy(alpha = .6f), CircleShape), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.PlayArrow, null, Modifier.size(16.dp), tint = Color.White)
        }
    }
}

@Composable
private fun Chip(name: String, busy: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Row(Modifier.clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh)
        .clickable(enabled = enabled, onClickLabel = "Save $name", onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        else Icon(Icons.Outlined.InsertDriveFile, null, Modifier.size(18.dp))
        Text(name, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
    }
}
