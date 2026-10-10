package ai.nuphos.android.ui.chat

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.PlaylistAdd
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.VerifiedUser
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import ai.nuphos.android.model.ComposerAttachment
import ai.nuphos.android.model.ComposerSubmission
import ai.nuphos.android.model.CredentialSelection
import ai.nuphos.android.model.PermissionMode
import ai.nuphos.android.ui.LocalAgentStore
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ai.nuphos.android.data.AttachmentTransfers
import ai.nuphos.android.data.AttachmentRetention
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.io.File
import java.io.InputStream
import java.io.FilterInputStream
import kotlin.math.abs

/**
 * Collapsed this is a single-line capsule; once focused (or holding
 * text/attachments) it opens into rows: a drag handle, optional controls,
 * the input on its own line, attachment tiles, then + and send/stop.
 */
@Composable
fun ChatComposer(
    isStreaming: Boolean,
    onSend: (ComposerSubmission) -> Boolean,
    canSubmit: Boolean = true,
    draft: ai.nuphos.android.session.ComposerDrafts.Lease? = null,
    draftingEnabled: Boolean = true,
    rejectedSubmission: ComposerSubmission? = null,
    onRejectedRestored: () -> Unit = {},
    onStop: (() -> Unit)? = null,
    showControls: Boolean = false,
    selection: CredentialSelection? = null,
    onSelectionChange: ((CredentialSelection) -> Unit)? = null,
    mode: PermissionMode? = null,
    onModeChange: ((PermissionMode) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val store = LocalAgentStore.current
    val scope = rememberCoroutineScope()
    var picking by remember { mutableStateOf(false) }
    var pickerError by remember { mutableStateOf<String?>(null) }
    var localText by remember(draft) { mutableStateOf("") }
    val text = draft?.text ?: localText
    fun updateText(value: String) {
        if (!draftingEnabled) return
        if (draft != null) draft.write(value) else localText = value
    }
    val attachments = remember { mutableStateListOf<ComposerAttachment>() }
    DisposableEffect(attachments) {
        onDispose {
            // Successful Send clears this list after ownership moves to the session.
            attachments.forEach { it.releaseOwnedCopy() }
            attachments.clear()
        }
    }
    var menu by remember { mutableStateOf(false) }
    var showIam by remember { mutableStateOf(false) }
    var showMode by remember { mutableStateOf(false) }
    var focused by remember { mutableStateOf(false) }
    var collapsedByUser by remember { mutableStateOf(false) }
    var handleDrag by remember { mutableFloatStateOf(0f) }
    val context = LocalContext.current
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val hasText = text.isNotBlank()
    val hasPayload = hasText || attachments.isNotEmpty()
    val expanded = (focused || hasPayload) && !collapsedByUser
    LaunchedEffect(rejectedSubmission, text.isEmpty(), attachments.isEmpty()) {
        if (rejectedSubmission != null && text.isEmpty() && attachments.isEmpty()) {
            updateText(rejectedSubmission.text)
            attachments.addAll(rejectedSubmission.attachments)
            onRejectedRestored()
        }
    }

    fun loadSelection(uris: List<Uri>, images: Boolean) {
        if (picking) return
        if (uris.isEmpty()) return
        picking = true
        pickerError = null
        val existing = attachments.toList()
        scope.launch {
            var loaded: List<ComposerAttachment> = emptyList()
            try {
                require(existing.size + uris.size <= AttachmentTransfers.MAX_FILES) { "Select at most 20 files." }
                withContext(Dispatchers.IO) {
                    val work = currentCoroutineContext()
                    val inputs = uris.map { selectionInput(context, it, images) }
                    loaded = AttachmentRetention(File(context.filesDir, "chat-attachments")).retain(
                        existing, inputs, check = { work.ensureActive() }, prepareImage = ::loadImage,
                    )
                }
                AttachmentTransfers().retain(attachments.toList() + loaded)
                attachments.addAll(loaded)
            } catch (e: Exception) {
                loaded.forEach { it.releaseOwnedCopy() }
                if (e is CancellationException) throw e
                pickerError = e.message ?: "Could not read the selected files."
            } finally { picking = false }
        }
    }
    val photos = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(20)) { loadSelection(it, true) }
    val files = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { loadSelection(it, false) }

    val resolvedSelection = selection ?: store.credentialSelection
    val resolvedMode = mode ?: store.permissionMode

    fun send() {
        if (!hasPayload || !canSubmit || !draftingEnabled || picking) return
        if (!onSend(ComposerSubmission(text.trim(), attachments.toList()))) return
        if (draft != null) draft.submitted(true, text) else localText = ""
        attachments.clear()
    }

    fun collapse() {
        collapsedByUser = true
        focused = false
        focusManager.clearFocus()
        keyboard?.hide()
        menu = false
    }

    val colors = MaterialTheme.colorScheme
    val fieldStyle = MaterialTheme.typography.bodyLarge.copy(color = colors.onSurface)

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .imePadding()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .graphicsLayer { translationY = handleDrag },
        shape = RoundedCornerShape(24.dp),
        color = colors.surfaceContainerHigh,
        tonalElevation = 3.dp,
        shadowElevation = 2.dp,
    ) {
        Column(
            Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (rejectedSubmission != null) Text("A rejected message is retained. Clear this draft to restore it.", modifier = Modifier.padding(horizontal = 12.dp))
            if (picking) Text("Reading files…", modifier = Modifier.padding(horizontal = 12.dp))
            pickerError?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 12.dp)) }
            AnimatedVisibility(
                visible = expanded,
                enter = fadeIn() + expandVertically(),
                exit = fadeOut() + shrinkVertically(),
            ) {
                ComposerDragHandle(
                    modifier = Modifier.composerCollapseGesture(
                        onDrag = { handleDrag = it },
                        onCollapse = {
                            handleDrag = 0f
                            collapse()
                        },
                    ),
                )
            }

            if (showControls) {
                AnimatedVisibility(
                    visible = expanded,
                    enter = fadeIn() + expandVertically(),
                    exit = fadeOut() + shrinkVertically(),
                ) {
                    Row(
                        Modifier.padding(horizontal = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        FilterChip(
                            selected = !resolvedSelection.isEmpty,
                            onClick = { showIam = true },
                            label = { Text(if (resolvedSelection.isEmpty) "IAM" else "IAM · ${resolvedSelection.count}") },
                            leadingIcon = { Icon(Icons.Outlined.Key, contentDescription = null, modifier = Modifier.size(16.dp)) },
                        )
                        FilterChip(
                            selected = resolvedMode == PermissionMode.Bypass,
                            onClick = { showMode = true },
                            label = { Text(resolvedMode.title) },
                            leadingIcon = { Icon(Icons.Rounded.VerifiedUser, contentDescription = null, modifier = Modifier.size(16.dp)) },
                        )
                    }
                }
            }

            // One text field, always in the same place: moving it between
            // expanded/collapsed branches recreates it and drops focus.
            Row(
                Modifier.padding(
                    start = if (expanded) 16.dp else 18.dp,
                    end = if (expanded) 16.dp else 6.dp,
                    top = if (expanded) 0.dp else 4.dp,
                    bottom = if (expanded) 0.dp else 4.dp,
                ),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BasicTextField(
                    value = text,
                    onValueChange = ::updateText,
                    enabled = draftingEnabled,
                    modifier = Modifier
                        .weight(1f)
                        .then(if (expanded) Modifier.heightIn(max = 192.dp) else Modifier)
                        .padding(vertical = if (expanded) 4.dp else 8.dp)
                        .onFocusChanged { state ->
                            focused = state.isFocused
                            if (state.isFocused) collapsedByUser = false
                        }
                        .semantics {
                            contentDescription = if (isStreaming) "Queue a message" else "Ask Nuphos anything"
                        },
                    textStyle = fieldStyle,
                    cursorBrush = SolidColor(colors.primary),
                    // Keep the scroll orientation stable when focus or payload changes.
                    singleLine = false,
                    maxLines = if (expanded) 8 else 1,
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Sentences,
                        imeAction = if (expanded) ImeAction.Default else ImeAction.Send,
                    ),
                    keyboardActions = KeyboardActions(onSend = { send() }),
                    decorationBox = { inner ->
                        Box(contentAlignment = Alignment.CenterStart) {
                            if (text.isEmpty()) {
                                Text(
                                    if (isStreaming) "Queue a message…" else "Ask Nuphos anything…",
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = colors.onSurfaceVariant,
                                )
                            }
                            inner()
                        }
                    },
                )
                AnimatedVisibility(
                    visible = !expanded,
                    enter = fadeIn() + expandHorizontally(),
                    exit = fadeOut() + shrinkHorizontally(),
                ) {
                    TrailingButton(
                        isStreaming = isStreaming,
                        hasPayload = hasPayload && canSubmit && !picking,
                        onStop = onStop,
                        onSend = ::send,
                    )
                }
            }

            AnimatedVisibility(
                visible = expanded && attachments.isNotEmpty(),
                enter = fadeIn() + expandVertically(),
                exit = fadeOut() + shrinkVertically(),
            ) {
                LazyRow(
                    Modifier.padding(horizontal = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(attachments, key = { it.id }) { attachment ->
                        AttachmentTile(attachment) {
                            attachments.removeAll { it.id == attachment.id }
                            attachment.releaseOwnedCopy()
                        }
                    }
                }
            }

            AnimatedVisibility(
                visible = expanded,
                enter = fadeIn() + expandVertically(),
                exit = fadeOut() + shrinkVertically(),
            ) {
                Row(
                    Modifier.padding(start = 6.dp, end = 6.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box {
                        IconButton(onClick = { menu = true }, enabled = canSubmit && !picking, modifier = Modifier.size(36.dp)) {
                            Icon(Icons.Outlined.Add, contentDescription = "Attach")
                        }
                        DropdownMenu(menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("Photos") }, onClick = {
                                menu = false
                                photos.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                            })
                            DropdownMenuItem(text = { Text("Files") }, onClick = {
                                menu = false
                                files.launch("*/*")
                            })
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    if (isStreaming && hasText && canSubmit) {
                        IconButton(onClick = ::send, modifier = Modifier.size(36.dp)) {
                            Icon(Icons.Outlined.PlaylistAdd, contentDescription = "Queue message")
                        }
                    }
                    TrailingButton(
                        isStreaming = isStreaming,
                        hasPayload = hasPayload && canSubmit && !picking,
                        onStop = onStop,
                        onSend = ::send,
                    )
                }
            }
        }
    }
    if (showIam && store != null) {
        CredentialPickerSheet(
            selection = resolvedSelection,
            onSelectionChange = {
                onSelectionChange?.invoke(it) ?: store.updateCredentialSelection(it)
            },
            onDismiss = { showIam = false },
        )
    }
    if (showMode) {
        PermissionModeSheet(
            mode = resolvedMode,
            onSelect = {
                onModeChange?.invoke(it) ?: store.updatePermissionMode(it)
                showMode = false
            },
            onDismiss = { showMode = false },
        )
    }
}

@Composable
private fun ComposerDragHandle(modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .height(28.dp)
            .semantics {
                contentDescription = "Collapse composer"
                role = Role.Button
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .width(36.dp)
                .height(5.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)),
        )
    }
}

private fun Modifier.composerCollapseGesture(
    onDrag: (Float) -> Unit,
    onCollapse: () -> Unit,
): Modifier = pointerInput(Unit) {
    val threshold = 40.dp.toPx()
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false)
        val tracker = VelocityTracker()
        tracker.addPosition(down.uptimeMillis, down.position)
        var total = 0f
        var dragging = false
        while (true) {
            val event = awaitPointerEvent()
            val change = event.changes.firstOrNull() ?: break
            if (!change.pressed) {
                if (dragging) {
                    val velocity = tracker.calculateVelocity().y
                    if (total > threshold || velocity > 1200f) {
                        onCollapse()
                    } else {
                        onDrag(0f)
                    }
                } else {
                    onCollapse()
                }
                break
            }
            val dy = change.positionChange().y
            tracker.addPosition(change.uptimeMillis, change.position)
            if (!dragging && abs(total + dy) > viewConfiguration.touchSlop) {
                dragging = true
            }
            if (dragging) {
                change.consume()
                total = (total + dy).coerceAtLeast(0f)
                onDrag(total)
            } else {
                total += dy
            }
        }
    }
}

@Composable
private fun TrailingButton(
    isStreaming: Boolean,
    hasPayload: Boolean,
    onStop: (() -> Unit)?,
    onSend: () -> Unit,
) {
    if (isStreaming && onStop != null) {
        FilledIconButton(
            onClick = onStop,
            modifier = Modifier.size(36.dp),
            shape = CircleShape,
        ) {
            Icon(Icons.Rounded.Stop, contentDescription = "Stop", modifier = Modifier.size(16.dp))
        }
    } else {
        FilledIconButton(
            onClick = onSend,
            enabled = hasPayload,
            modifier = Modifier.size(36.dp),
            shape = CircleShape,
            colors = IconButtonDefaults.filledIconButtonColors(
                disabledContainerColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f),
            ),
        ) {
            Icon(Icons.Rounded.ArrowUpward, contentDescription = "Send", modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun AttachmentTile(attachment: ComposerAttachment, onRemove: () -> Unit) {
    Box(Modifier.size(64.dp)) {
        when (val kind = attachment.kind) {
            is ComposerAttachment.Kind.Image -> {
                val bmp = remember(kind) { BitmapFactory.decodeByteArray(kind.jpeg, 0, kind.jpeg.size)?.asImageBitmap() }
                if (bmp != null) {
                    Image(bmp, contentDescription = attachment.name, modifier = Modifier.size(64.dp).clip(RoundedCornerShape(12.dp)), contentScale = ContentScale.Crop)
                }
            }
            is ComposerAttachment.Kind.File, is ComposerAttachment.Kind.RetainedFile -> {
                Column(
                    Modifier
                        .size(64.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(MaterialTheme.colorScheme.surfaceContainerHighest),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(Icons.Outlined.InsertDriveFile, contentDescription = null)
                    Text(attachment.fileExtension, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
        IconButton(onClick = onRemove, modifier = Modifier.align(Alignment.TopEnd).size(20.dp).background(MaterialTheme.colorScheme.onSurface, CircleShape)) {
            Icon(Icons.Outlined.Close, contentDescription = "Remove", tint = MaterialTheme.colorScheme.surface, modifier = Modifier.size(12.dp))
        }
    }
}

private fun selectionInput(context: android.content.Context, uri: Uri, images: Boolean): AttachmentRetention.Input {
    var name = "attachment"
    var size: Long? = null
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            val nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (nameColumn >= 0 && !cursor.isNull(nameColumn)) name = cursor.getString(nameColumn)?.takeIf { it.isNotBlank() } ?: name
            if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) size = cursor.getLong(sizeColumn).takeIf { it >= 0 }
        }
    }
    val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
    return AttachmentRetention.Input(name, mime, size, images || mime.startsWith("image/")) {
        requireNotNull(context.contentResolver.openInputStream(uri)) { "Could not open the selected file." }
    }
}

private fun imageInput(input: AttachmentRetention.Input): InputStream = object : FilterInputStream(input.open()) {
    private var readBytes = 0L
    private fun count(size: Int): Int {
        if (size > 0) {
            readBytes += size
            require(readBytes <= AttachmentTransfers.MAX_FILE_BYTES) { "Image exceeds 100 MiB." }
        }
        return size
    }
    override fun read(): Int = super.read().also { if (it >= 0) count(1) }
    override fun read(bytes: ByteArray, offset: Int, length: Int): Int = count(`in`.read(bytes, offset, minOf(length.toLong(), AttachmentTransfers.MAX_FILE_BYTES - readBytes + 1).toInt()))
    override fun skip(count: Long): Long {
        val skipped = `in`.skip(minOf(count, AttachmentTransfers.MAX_FILE_BYTES - readBytes + 1))
        readBytes += skipped
        require(readBytes <= AttachmentTransfers.MAX_FILE_BYTES) { "Image exceeds 100 MiB." }
        return skipped
    }
}

private fun loadImage(input: AttachmentRetention.Input, remaining: Long): ComposerAttachment {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    imageInput(input).use { BitmapFactory.decodeStream(it, null, bounds) }
    require(bounds.outWidth > 0 && bounds.outHeight > 0) { "This image cannot be read." }
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 3136) sample *= 2
    val bitmap = requireNotNull(imageInput(input).use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }) { "This image cannot be read." }
    val scale = minOf(1f, 1568f / maxOf(bitmap.width, bitmap.height))
    var resized = bitmap
    val out = object : ByteArrayOutputStream() {
        override fun write(value: Int) {
            require(size().toLong() + 1 <= remaining) { "Image exceeds the remaining attachment size limit." }
            super.write(value)
        }
        override fun write(bytes: ByteArray, offset: Int, length: Int) {
            require(size().toLong() + length <= remaining) { "Image exceeds the remaining attachment size limit." }
            super.write(bytes, offset, length)
        }
    }
    try {
        if (scale < 1f) resized = Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt().coerceAtLeast(1), (bitmap.height * scale).toInt().coerceAtLeast(1), true)
        check(resized.compress(Bitmap.CompressFormat.JPEG, 80, out)) { "Could not prepare the image." }
    } finally { if (resized !== bitmap) resized.recycle(); bitmap.recycle() }
    val name = input.name.substringBeforeLast('.', input.name) + ".jpg"
    return ComposerAttachment(name = name, kind = ComposerAttachment.Kind.Image(out.toByteArray()))
}
