package ai.nuphos.android.ui.chat

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import ai.nuphos.android.data.TransferDownloadFile
import ai.nuphos.android.data.TransferDownloadGroup
import ai.nuphos.android.data.TransferDownloads
import ai.nuphos.android.model.TransferUpload
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/** Sent uploads resolve through the same team-scoped API as iOS; credentials never reach storage. */
@Composable
internal fun TransferCard(
    attachment: TransferUpload,
    loadGroup: suspend () -> TransferDownloadGroup,
    canAccess: Boolean,
    allowed: () -> Boolean,
    downloads: TransferDownloads = remember { TransferDownloads() },
) {
    if (!canAccess) {
        Text("Attachments unavailable", style = MaterialTheme.typography.bodySmall)
        return
    }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val directory = remember(attachment.groupId) { File.createTempFile("transfer-", "", context.cacheDir).apply { delete(); mkdirs() } }
    val cached = remember(directory) { ConcurrentHashMap<String, File>() }
    DisposableEffect(directory) { onDispose { directory.deleteRecursively() } }
    val latestAllowed by rememberUpdatedState(allowed)
    val latestLoad by rememberUpdatedState(loadGroup)
    var files by remember(attachment.groupId) { mutableStateOf<List<TransferDownloadFile>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var unavailable by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var retry by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf<String?>(null) }
    var pendingSave by remember { mutableStateOf<File?>(null) }
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
    LaunchedEffect(attachment.groupId, retry) {
        loading = true
        unavailable = false
        try {
            val group = latestLoad()
            check(latestAllowed())
            files = group.readyFiles(attachment.groupId)
            unavailable = files.isEmpty()
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { files = emptyList(); unavailable = true }
        finally { loading = false }
    }
    suspend fun fresh(fileId: String): TransferDownloadFile {
        check(latestAllowed())
        val file = latestLoad().readyFiles(attachment.groupId).single { it.id == fileId }
        check(latestAllowed())
        return file
    }
    val imageLoader: MessageImageLoader = remember(directory, retry, downloads) {
        { id, edge ->
            try {
                val remote = fresh(id)
                val local = cached[id]?.takeIf { it.isFile } ?: withContext(Dispatchers.IO) {
                    val file = File.createTempFile("image-", ".preview", directory)
                    try {
                        file.outputStream().use { downloads.copy(remote, it) { latestAllowed() } }
                        cached[id] = file
                        file
                    } catch (error: Exception) { file.delete(); throw error }
                }
                check(latestAllowed())
                MessageImageDecoder.decodeFile(local, edge)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { null }
        }
    }
    Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.padding(12.dp).widthIn(max = 300.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Attachments", style = MaterialTheme.typography.labelMedium)
            if (loading || unavailable) attachment.names.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
            if (loading) Text("Loading attachments…", style = MaterialTheme.typography.bodySmall)
            val images = files.filter { it.isImage }.map { it.id }
            if (images.isNotEmpty()) MessageImages(images, "transfer.${attachment.groupId}", imageLoader)
            files.forEach { file ->
                Text(file.fileName, style = MaterialTheme.typography.bodySmall)
                TextButton(enabled = busy == null && pendingSave == null, onClick = {
                    busy = file.id
                    failed = false
                    scope.launch {
                        var local: File? = null
                        try {
                            val remote = fresh(file.id)
                            val destination = withContext(Dispatchers.IO) { File.createTempFile("save-", ".download", directory) }
                            local = destination
                            withContext(Dispatchers.IO) { destination.outputStream().use { downloads.copy(remote, it) { latestAllowed() } } }
                            check(latestAllowed())
                            pendingSave = local
                            save.launch(file.safeName)
                            local = null
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (_: Exception) { failed = true }
                        finally { local?.delete(); busy = null }
                    }
                }) { Text(if (busy == file.id) "Downloading…" else "Save ${file.fileName}") }
            }
            if (unavailable) Text("Attachments expired or unavailable", style = MaterialTheme.typography.bodySmall)
            if (failed) Text("Couldn't save the file. Try again.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            if (unavailable || failed) TextButton(enabled = !loading && busy == null, onClick = { failed = false; retry++ }) { Text("Retry attachments") }
        }
    }
}
