package ai.nuphos.android.ui.chat

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton

import android.Manifest
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.runtime.rememberUpdatedState
import ai.nuphos.android.voice.*

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.content.ReceiveContentListener
import androidx.compose.foundation.content.contentReceiver
import androidx.compose.foundation.content.consume
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.InputTransformation
import androidx.compose.foundation.text.input.KeyboardActionHandler
import kotlinx.coroutines.Job
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.Photo
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.Computer
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
import androidx.compose.material3.ripple
import androidx.compose.material3.Text
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import ai.nuphos.android.model.ComposerAttachment
import ai.nuphos.android.model.ComposerSubmission
import ai.nuphos.android.model.CredentialSelection
import ai.nuphos.android.model.PermissionMode
import ai.nuphos.android.ui.components.AgentAvatar
import ai.nuphos.android.session.RuntimeSelections
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.agent.AgentChip
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ai.nuphos.android.data.AttachmentTransfers
import ai.nuphos.android.data.AttachmentRetention
import kotlinx.coroutines.isActive
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.io.File
import java.io.InputStream
import java.io.FilterInputStream
import kotlin.math.abs

/**
 * Collapsed this is a single-line capsule; once focused (or holding
 * text/attachments) it opens into runtime controls, the input on its own line,
 * attachment tiles, then Photos/Files/Paste and send/stop.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ChatComposer(
    isStreaming: Boolean,
    onSend: (ComposerSubmission) -> Boolean,
    canSubmit: Boolean = true,
    sendQueues: Boolean = false,
    recalledFiles: List<ComposerAttachment> = emptyList(),
    onRecalledFilesRestored: () -> Unit = {},
    draft: ai.nuphos.android.session.ComposerDrafts.Lease? = null,
    mentions: SessionMentionSource? = null,
    devices: DeviceMentionSource? = null,
    draftingEnabled: Boolean = true,
    rejectedSubmission: ComposerSubmission? = null,
    onRejectedRestored: () -> Unit = {},
    onStop: (() -> Unit)? = null,
    showControls: Boolean = false,
    selection: CredentialSelection? = null,
    onSelectionChange: ((CredentialSelection) -> Unit)? = null,
    mode: PermissionMode? = null,
    onModeChange: ((PermissionMode) -> Unit)? = null,
    agent: RuntimeSelections.Selection? = null,
    agentEnabled: Boolean = true,
    modelSettings: ai.nuphos.android.session.ModelSettingsStore? = null,
    agentLabel: String? = null,
    agentQuota: ai.nuphos.android.data.RuntimeQuota? = null,
    onChooseAgent: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val store = LocalAgentStore.current
    val context = LocalContext.current
    val incomingShares = (context.applicationContext as ai.nuphos.android.NuphosApplication).incomingShares
    val scope = rememberCoroutineScope()
    val shareReady by incomingShares.ready.collectAsState()
    val shareRevision by incomingShares.revision.collectAsState()
    val storageError by incomingShares.persistenceError.collectAsState()
    // Reading the projection revision makes restored/committed text observable without any disk access.
    @Suppress("UNUSED_VARIABLE") val observedShareRevision = shareRevision
    val effectiveDraftingEnabled = draftingEnabled && shareReady && (draft == null || incomingShares.isBound(draft.key.accountId))
    var savingSend by remember { mutableStateOf(false) }
    val latestSendAllowed by rememberUpdatedState(effectiveDraftingEnabled && canSubmit)
    val latestSendKey by rememberUpdatedState(draft?.key)
    val latestOnSend by rememberUpdatedState(onSend)
    var showComputers by remember(draft, store?.workspaceRevision) { mutableStateOf(false) }
    var showModel by remember(modelSettings) { mutableStateOf(false) }
    var picking by remember(draft) { mutableStateOf(false) }
    var pickerError by remember(draft) { mutableStateOf<String?>(null) }
    var focused by remember { mutableStateOf(false) }
    var localText by remember(draft) { mutableStateOf("") }
    val fieldState = remember(draft, effectiveDraftingEnabled) {
        val initial = if (effectiveDraftingEnabled) draft?.let { incomingShares.text(it.key) ?: it.text } ?: localText else ""
        TextFieldState(initial, TextRange(initial.length))
    }
    val text = fieldState.text.toString()
    fun updateText(value: String) {
        if (!effectiveDraftingEnabled || savingSend) return
        try { draft?.key?.let { incomingShares.writeText(it, value) } }
        catch (_: Exception) { pickerError = "Could not save this draft. Free storage and try again."; return }
        fieldState.edit {
            replace(0, length, value)
            this.selection = TextRange(value.length)
        }
        if (draft != null) draft.write(value) else localText = value
    }
    val externalText = if (effectiveDraftingEnabled) draft?.let { incomingShares.text(it.key) ?: it.text } ?: localText else ""
    LaunchedEffect(draft, externalText) {
        if (effectiveDraftingEnabled && draft != null && incomingShares.text(draft.key) != null) draft.write(externalText)
        if (externalText != fieldState.text.toString()) {
            fieldState.edit {
                replace(0, length, externalText)
                this.selection = TextRange(externalText.length)
            }
        }
    }
    val fieldValue = TextFieldValue(text, fieldState.selection)
    var dismissedAt by remember(draft, mentions?.teamId) { mutableIntStateOf(-1) }
    val mentionQuery = if (effectiveDraftingEnabled && focused && mentions != null) SessionMention.query(fieldValue) else null
    val activeMention = mentionQuery?.takeUnless { text.lastIndexOf('@') == dismissedAt }
    var mentionRows by remember(activeMention, draft, mentions) { mutableStateOf<List<ai.nuphos.android.model.AgentConversation>>(emptyList()) }
    var mentionLoading by remember(activeMention, draft, mentions) { mutableStateOf(activeMention != null) }
    var mentionFailed by remember(activeMention, draft, mentions) { mutableStateOf(false) }
    LaunchedEffect(activeMention, mentions, draft) {
        mentionRows = emptyList()
        mentionFailed = false
        mentionLoading = activeMention != null
        val source = mentions
        if (activeMention == null || source == null) return@LaunchedEffect
        try {
            kotlinx.coroutines.delay(150)
            val found = source.search(activeMention)
            currentCoroutineContext().ensureActive()
            mentionRows = SessionMention.results(found, source)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            mentionFailed = true
        } finally {
            // A canceled older search must not clear a newer search's spinner.
            if (currentCoroutineContext().isActive) mentionLoading = false
        }
    }
    var deviceRows by remember(activeMention, draft, devices) { mutableStateOf<List<ai.nuphos.android.model.CredentialCatalog.Item>>(emptyList()) }
    var devicesLoading by remember(activeMention, draft, devices) { mutableStateOf(false) }
    var devicesFailed by remember(activeMention, draft, devices) { mutableStateOf(false) }
    var devicePickFailed by remember(activeMention, draft, devices) { mutableStateOf(false) }
    LaunchedEffect(activeMention, devices, draft) {
        deviceRows = emptyList()
        devicesFailed = false
        devicesLoading = activeMention != null && devices != null
        if (activeMention == null || devices == null || devices.teamId != mentions?.teamId) return@LaunchedEffect
        try {
            kotlinx.coroutines.delay(150)
            val found = devices.load()
            currentCoroutineContext().ensureActive()
            deviceRows = found
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            devicesFailed = true
        } finally {
            if (currentCoroutineContext().isActive) devicesLoading = false
        }
    }
    val attachments = remember(draft, effectiveDraftingEnabled) {
        mutableStateListOf<ComposerAttachment>().apply { if (effectiveDraftingEnabled) draft?.key?.let { addAll(incomingShares.attachments(it)) } }
    }
    var attachmentJob by remember(draft) { mutableStateOf<Job?>(null) }
    DisposableEffect(draft, attachments) {
        onDispose {
            attachmentJob?.cancel()
            // Successful Send clears this list after ownership moves to the session.
            val abandoned = attachments.toList()
            attachments.clear()
            incomingShares.releaseLater(abandoned)
        }
    }
    var menu by remember { mutableStateOf(false) }
    var showAgentUsage by remember { mutableStateOf(false) }
    var showIam by remember { mutableStateOf(false) }
    var showMode by remember { mutableStateOf(false) }
    var collapsedByUser by remember { mutableStateOf(false) }
    var handleDrag by remember { mutableFloatStateOf(0f) }
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val injectedVoice = LocalVoiceServices.current
    val voiceServices = remember(context, injectedVoice) { injectedVoice ?: deviceVoiceServices(context) }
    val latestText by rememberUpdatedState(text)
    val latestWrite by rememberUpdatedState<(String) -> Boolean> { words ->
        if (!effectiveDraftingEnabled || savingSend) false else {
            val appended = appendDictation(latestText, words)
            updateText(appended)
            fieldState.text.toString() == appended
        }
    }
    val voiceAuth = ai.nuphos.android.ui.LocalAuthSession.current
    val voiceToken = voiceAuth.token.orEmpty()
    val voiceAccount = voiceAuth.user?.id
    val voiceTeam = draft?.key?.teamId ?: store.selectedTeam?.id
    val voiceConsentRevision = ai.nuphos.android.session.AiAccess.revision
    val latestVoiceAllowed by rememberUpdatedState(effectiveDraftingEnabled)
    val voice = remember(draft, voiceServices, voiceToken, voiceAccount, voiceTeam,
        voiceAuth.generation, store.workspaceRevision, voiceConsentRevision) {
        val authGeneration = voiceAuth.generation
        val workspaceRevision = store.workspaceRevision
        fun current() = latestVoiceAllowed && voiceToken.isNotBlank() && voiceAccount != null && voiceTeam != null &&
            voiceAuth.token == voiceToken && voiceAuth.generation == authGeneration && voiceAuth.user?.id == voiceAccount &&
            store.workspaceRevision == workspaceRevision && store.selectedTeam?.id == voiceTeam &&
            ai.nuphos.android.session.AiAccess.allows(voiceToken) &&
            (draft == null || draft.key.accountId == voiceAccount)
        val access = ai.nuphos.android.voice.VoiceAccess(voiceToken, voiceTeam.orEmpty(), ::current,
            unauthorized = { if (current()) voiceAuth.signOut(ai.nuphos.android.data.NuphosApi.Failure.Unauthorized.message) })
        VoiceInput(voiceServices, scope, access) { latestWrite(it) }
    }
    var voiceSendRequested by remember(draft, voice) { mutableStateOf(false) }
    var permissionTarget by remember { mutableStateOf<VoiceInput?>(null) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        permissionTarget?.permissionResult(granted)
        permissionTarget = null
    }
    fun startVoice() {
        if (voice.active || !effectiveDraftingEnabled || picking) return
        try {
            if (!voice.available) { voice.error = "Choose a workspace and confirm your AI sharing choice to use voice input."; return }
            focusManager.clearFocus()
            keyboard?.hide()
            voice.awaitingPermission()
            if (voiceServices.microphonePermissionGranted()) voice.permissionResult(true)
            else if (permissionTarget == null) { permissionTarget = voice; permission.launch(Manifest.permission.RECORD_AUDIO) }
            else voice.cancel()
        } catch (_: Exception) { voice.cancel(); voice.error = "Could not start voice input. Check microphone permission and try again." }
    }
    val voiceView = androidx.compose.ui.platform.LocalView.current
    DisposableEffect(voice.phase == VoiceInput.Phase.Recording, voiceView) {
        val previous = voiceView.keepScreenOn
        if (voice.phase == VoiceInput.Phase.Recording) voiceView.keepScreenOn = true
        onDispose { voiceView.keepScreenOn = previous }
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(voice, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) { voice.cancel() }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); voice.cancel() }
    }
    LaunchedEffect(effectiveDraftingEnabled) { if (!effectiveDraftingEnabled) attachmentJob?.cancel() }
    LaunchedEffect(effectiveDraftingEnabled) { if (!effectiveDraftingEnabled) voice.cancel() }
    BackHandler(enabled = voice.active) { voice.cancel() }
    voice.error?.let { message ->
        AlertDialog(onDismissRequest = { voice.error = null }, title = { Text("Voice input failed") },
            text = { Column {
                Text(message)
                voice.pendingText?.let { words -> androidx.compose.foundation.text.selection.SelectionContainer { Text(words) } }
            } },
            confirmButton = {
                if (voice.pendingText != null) TextButton(onClick = voice::retryText) { Text("Add to draft") }
                else TextButton(onClick = { voice.error = null }) { Text("OK") }
            },
            dismissButton = { if (voice.pendingText != null) TextButton(onClick = voice::discardText) { Text("Discard transcript") } })
    }
    val hasText = text.isNotBlank()
    val hasPayload = hasText || attachments.isNotEmpty()
    val expanded = (focused || hasPayload) && !collapsedByUser
    LaunchedEffect(rejectedSubmission, text.isEmpty(), attachments.isEmpty(), savingSend) {
        if (savingSend) return@LaunchedEffect
        if (rejectedSubmission != null && text.isEmpty() && attachments.isEmpty()) {
            updateText(rejectedSubmission.text)
            attachments.addAll(rejectedSubmission.attachments)
            onRejectedRestored()
        }
    }

    LaunchedEffect(recalledFiles, effectiveDraftingEnabled, savingSend, attachments.size) {
        if (effectiveDraftingEnabled && !savingSend && recalledFiles.isNotEmpty()) {
            try {
                val missing = recalledFiles.filter { file -> attachments.none { it.id == file.id } }
                AttachmentTransfers().retain(attachments.toList() + missing)
                attachments.addAll(missing)
                onRecalledFilesRestored()
            } catch (error: Exception) {
                pickerError = "Queued attachments are retained but could not fit in this draft. Remove an attachment and try again."
            }
        }
    }

    // Picker results and suspended reads belong to the exact draft/access scope that started them.
    val selectionScope = remember(draft, effectiveDraftingEnabled, voiceAuth.generation, voiceAuth.user?.id,
        store.workspaceRevision, store.selectedTeam?.id, ai.nuphos.android.session.AiAccess.revision) { Any() }
    val latestSelectionScope by rememberUpdatedState(selectionScope)
    val latestDraftingAllowed by rememberUpdatedState(effectiveDraftingEnabled && !savingSend)
    var pickerTarget by remember { mutableStateOf<Any?>(null) }
    fun loadSelection(uris: List<Uri>, images: Boolean, permissionOwner: Any? = null) {
        if (!effectiveDraftingEnabled || savingSend || voice.active) return
        if (picking) { pickerError = "Wait for the current files to finish loading, then try again."; return }
        if (uris.isEmpty()) return
        picking = true
        pickerError = null
        val existing = attachments.toList()
        attachmentJob = scope.launch {
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
                check(latestSelectionScope === selectionScope && latestDraftingAllowed) {
                    "The draft changed while reading files. Select the files again."
                }
                AttachmentTransfers().retain(attachments.toList() + loaded)
                attachments.addAll(loaded)
            } catch (e: Exception) {
                loaded.forEach { it.releaseOwnedCopy() }
                if (e is CancellationException) throw e
                pickerError = e.message ?: "Could not read the selected files."
            } finally {
                java.lang.ref.Reference.reachabilityFence(permissionOwner)
                picking = false
            }
        }
    }
    fun pickerResult(uris: List<Uri>, images: Boolean) {
        val target = pickerTarget
        pickerTarget = null
        if (uris.isEmpty()) return
        if (target !== selectionScope || !effectiveDraftingEnabled || savingSend || voice.active) {
            pickerError = "The draft changed while choosing files. Select the files again."
            return
        }
        loadSelection(uris, images)
    }
    val photos = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(20)) { pickerResult(it, true) }
    val files = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { pickerResult(it, false) }

    val receiveContent = ReceiveContentListener { content ->
        if (!effectiveDraftingEnabled || voice.active) content else {
            val uris = mutableListOf<Uri>()
            val remaining = content.consume { item ->
                val uri = item.uri
                if (uri?.scheme == "content") {
                    uris += uri
                    true
                } else false
            }
            if (uris.isNotEmpty()) loadSelection(uris, false, content)
            remaining
        }
    }

    val incomingShare by incomingShares.state.collectAsState()
    LaunchedEffect(incomingShare, draft, effectiveDraftingEnabled, store.selectedTeam?.id, savingSend) {
        val shared = incomingShare ?: return@LaunchedEffect
        val lease = draft ?: return@LaunchedEffect
        if (savingSend || !effectiveDraftingEnabled || store.selectedTeam?.id != lease.key.teamId || shared.destination != lease.key || shared.loading || shared.error != null) return@LaunchedEffect
        var staged = emptyList<ComposerAttachment>()
        val before = attachments.toList()
        try {
            require(before.size + shared.attachments.size <= AttachmentTransfers.MAX_FILES)
            if (before.isNotEmpty() || shared.attachments.isNotEmpty()) AttachmentTransfers().retain(before + shared.attachments)
            withContext(Dispatchers.IO) {
                val work = currentCoroutineContext()
                staged = incomingShares.prepare(before + shared.attachments) { work.ensureActive() }
            }
            withContext(Dispatchers.Main.immediate) {
                if (!effectiveDraftingEnabled || store.selectedTeam?.id != lease.key.teamId || incomingShares.state.value?.id != shared.id ||
                    attachments.map { it.id } != before.map { it.id }) throw CancellationException("Draft changed")
                val merged = listOf(fieldState.text.toString(), shared.text).filter { it.isNotEmpty() }.joinToString("\n\n")
                // Durable transaction consumes the share and publishes text+files together before any preference update.
                val receivingJob = currentCoroutineContext()
                if (!incomingShares.consumed(shared.id, lease.key, merged, staged) {
                        // Publish the IO-committed projection and update this composer before clearing the pending-share flow.
                        if (receivingJob.isActive && effectiveDraftingEnabled && store.selectedTeam?.id == lease.key.teamId &&
                            attachments.map { it.id } == before.map { it.id } && lease.write(merged)) {
                            fieldState.edit { replace(0, length, merged); this.selection = TextRange(merged.length) }
                            attachments.clear()
                            attachments.addAll(staged)
                            incomingShares.releaseLater(before.filter { old -> staged.none { it === old } })
                        }
                    }) throw CancellationException("Share changed")
            }
        } catch (failure: Exception) {
            withContext(kotlinx.coroutines.NonCancellable + Dispatchers.Main.immediate) {
                // Queue cleanup after any already-enqueued consumption/deletion, so cancellation cannot unlink an in-flight commit.
                incomingShares.releaseUnowned(staged.filter { file -> before.none { it === file } && shared.attachments.none { it === file } })
                if (failure !is CancellationException)
                    incomingShares.failed(shared.id, "Could not save this share. Check the draft limits and free storage, then try again.", retryable = true)
            }
            if (failure is CancellationException) throw failure
        }
    }

    val resolvedSelection = selection ?: store.credentialSelection
    val resolvedMode = mode ?: store.permissionMode

    fun send() {
        if (!hasPayload || !canSubmit || !effectiveDraftingEnabled || picking || savingSend || incomingShare != null || voice.active) return
        val key = draft?.key
        val submittedText = text
        val submittedFiles = attachments.toList()
        savingSend = true
        scope.launch {
            var accepted = false
            try {
                key?.let { incomingShares.checkWritable(it) }
                if (!latestSendAllowed || latestSendKey != key || incomingShares.state.value != null ||
                    (key != null && (!incomingShares.isBound(key.accountId) || store.selectedTeam?.id != key.teamId)) ||
                    fieldState.text.toString() != submittedText || attachments.map { it.id } != submittedFiles.map { it.id }) return@launch
                accepted = latestOnSend(ComposerSubmission(submittedText.trim(), submittedFiles))
                if (accepted) {
                    if (key != null) incomingShares.sent(key, submittedFiles) else incomingShares.handoff(submittedFiles)
                }
            } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                pickerError = if (accepted) "Message accepted, but saved draft cleanup failed. Do not resend it."
                    else "Could not update saved drafts. Free storage before sending."
            } finally {
                if (accepted) {
                    if (draft != null) draft.submitted(true, submittedText) else localText = ""
                    if (fieldState.text.toString() == submittedText) fieldState.edit { replace(0, length, "") }
                    attachments.removeAll { file -> submittedFiles.any { it.id == file.id } }
                }
                savingSend = false
            }
        }
    }

    LaunchedEffect(voice, voiceSendRequested) {
        if (voiceSendRequested) {
            voiceSendRequested = false
            send() // Read the recomposed transcript and recheck the normal send guards.
        }
    }

    fun collapse() {
        collapsedByUser = true
        focused = false
        focusManager.clearFocus()
        keyboard?.hide()
        menu = false
    }

    BackHandler(enabled = activeMention != null) {
        dismissedAt = text.lastIndexOf('@')
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
            if (activeMention != null && mentions != null) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(if (devices == null) "My agents" else "Mention", style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                        IconButton(onClick = { dismissedAt = text.lastIndexOf('@') }, modifier = Modifier.size(32.dp)) {
                            Icon(Icons.Outlined.Close, contentDescription = if (devices == null) "Dismiss agent mentions" else "Dismiss mentions", modifier = Modifier.size(16.dp))
                        }
                    }
                    Column(Modifier.heightIn(max = 80.dp).verticalScroll(rememberScrollState())) {
                    if (devices != null && devices.teamId == mentions.teamId) {
                        Text("Computers", style = MaterialTheme.typography.labelSmall)
                        Text("Selecting allows this agent to operate the computer.", style = MaterialTheme.typography.labelSmall)
                        val computers = DeviceMention.results(deviceRows, activeMention, resolvedSelection)
                        when {
                            devicesLoading -> Text("Loading computers…", style = MaterialTheme.typography.bodySmall)
                            devicesFailed -> Text("Could not load computers. You can keep typing.", style = MaterialTheme.typography.bodySmall)
                            computers.isEmpty() -> Text("No matching computers", style = MaterialTheme.typography.bodySmall)
                            else -> computers.forEach { device ->
                                Column(Modifier.fillMaxWidth().clickable(enabled = !device.unavailable, role = Role.Button) {
                                    if (SessionMention.query(fieldValue) == activeMention && effectiveDraftingEnabled) {
                                        // Do not insert text on rejected selection; never interpret typed @text as IAM.
                                        if (devices.pick(device)) {
                                            val inserted = SessionMention.insert(text, "@" + device.label)
                                            updateText(inserted)
                                        } else devicePickFailed = true
                                    }
                                }.padding(vertical = 8.dp)) {
                                    Text(
                                        device.label + when {
                                            device.unavailable -> " · Unavailable"
                                            resolvedSelection.contains(device) -> " · Selected"
                                            else -> ""
                                        },
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        color = if (device.unavailable) colors.onSurfaceVariant else colors.onSurface,
                                    )
                                    DeviceMention.identity(device, deviceRows)?.let { identity ->
                                        Text(identity, style = MaterialTheme.typography.bodySmall, maxLines = 1)
                                    }
                                }
                            }
                        }
                        if (devicePickFailed) Text("Computer selection unavailable. IAM was not changed.", style = MaterialTheme.typography.bodySmall)
                        Text("My agents", style = MaterialTheme.typography.labelSmall)
                    }
                    when {
                        mentionLoading -> Text("Searching agents…", style = MaterialTheme.typography.bodySmall)
                        mentionFailed -> Text("Could not search agents. You can keep typing.", style = MaterialTheme.typography.bodySmall)
                        mentionRows.isEmpty() -> Text("No matching agents", style = MaterialTheme.typography.bodySmall)
                        else -> mentionRows.forEach { row ->
                            Row(
                                Modifier.fillMaxWidth().clickable(role = Role.Button) {
                                    // Recheck the current draft; never insert a result from a replaced query.
                                    if (SessionMention.query(fieldValue) == activeMention && effectiveDraftingEnabled) {
                                        val inserted = SessionMention.insert(text, SessionMention.link(mentions.teamId, row.sessionId))
                                        updateText(inserted)
                                    }
                                }.padding(vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                AgentAvatar(row.sessionId, row.agentRuntime, 20.dp)
                                Text(row.displayTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                    }
                }
            }
            if (rejectedSubmission != null) Text("A rejected message is retained. Clear this draft to restore it.", modifier = Modifier.padding(horizontal = 12.dp))
            if (picking) Text("Reading files…", modifier = Modifier.padding(horizontal = 12.dp))
            (pickerError ?: storageError)?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 12.dp)) }

            if (showControls) {
                AnimatedVisibility(
                    visible = expanded,
                    enter = fadeIn() + expandVertically(),
                    exit = fadeOut() + shrinkVertically(),
                ) {
                    // IAM and permission mode remain in the expandable control row.
                    Row(
                        Modifier
                            .horizontalScroll(rememberScrollState())
                            .padding(horizontal = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (onChooseAgent != null || agentLabel != null) AgentChip(agent, enabled = agentEnabled,
                            onClick = onChooseAgent ?: { showAgentUsage = true }, labelOverride = agentLabel)
                        if (modelSettings != null) FilterChip(
                            selected = modelSettings.pending.isNotEmpty(),
                            onClick = { showModel = true },
                            label = { Text(modelSettings.config?.modelTitle ?: "Model") },
                        )
                        FilterChip(
                            selected = !resolvedSelection.isEmpty,
                            onClick = { showIam = true },
                            label = { Text(if (resolvedSelection.isEmpty) "Credentials" else "Credentials · ${resolvedSelection.count}") },
                            leadingIcon = { Icon(Icons.Outlined.Key, contentDescription = null, modifier = Modifier.size(16.dp)) },
                        )
                        FilterChip(
                            selected = resolvedSelection.ids["deviceIds"].orEmpty().isNotEmpty(),
                            onClick = { showComputers = true },
                            label = { Text("Computers" + resolvedSelection.ids["deviceIds"].orEmpty().size.takeIf { it > 0 }?.let { " · $it" }.orEmpty()) },
                            leadingIcon = { Icon(Icons.Outlined.Computer, null, Modifier.size(16.dp)) },
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
                if (voice.active) VoiceRecordingBar(voice, canSend = canSubmit && effectiveDraftingEnabled && !savingSend && !picking, onSendReady = { voiceSendRequested = true }) else BasicTextField(
                    state = fieldState,
                    inputTransformation = InputTransformation {
                        if (!effectiveDraftingEnabled || savingSend) revertAllChanges()
                        else {
                            val value = asCharSequence().toString()
                            if (SessionMention.query(value) == null) dismissedAt = -1
                            try {
                                draft?.key?.let { incomingShares.writeText(it, value) }
                                if (draft != null) draft.write(value) else localText = value
                            } catch (_: Exception) {
                                revertAllChanges()
                                pickerError = "Could not save this draft. Free storage and try again."
                            }
                        }
                    },
                    enabled = effectiveDraftingEnabled && !savingSend,
                    modifier = Modifier
                        .weight(1f)
                        .contentReceiver(receiveContent)
                        .then(if (expanded) Modifier.heightIn(max = 192.dp) else Modifier)
                        .padding(vertical = if (expanded) 4.dp else 8.dp)
                        .onFocusChanged { state ->
                            focused = state.isFocused
                            if (state.isFocused) collapsedByUser = false
                        }
                        .semantics {
                            contentDescription = if (isStreaming || sendQueues) "Queue a message" else "Ask Nuphos anything"
                        },
                    textStyle = fieldStyle,
                    cursorBrush = SolidColor(colors.primary),
                    // Keep the scroll orientation stable when focus or payload changes.
                    lineLimits = TextFieldLineLimits.MultiLine(maxHeightInLines = if (expanded) 8 else 1),
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Sentences,
                        imeAction = if (expanded) ImeAction.Default else ImeAction.Send,
                    ),
                    onKeyboardAction = KeyboardActionHandler { send() },
                    decorator = { inner ->
                        Box(contentAlignment = Alignment.CenterStart) {
                            if (text.isEmpty()) {
                                Text(
                                    if (isStreaming || sendQueues) "Queue a message…" else "Ask Nuphos anything…",
                                    style = MaterialTheme.typography.bodyLarge,
                                    maxLines = if (expanded) 8 else 1,
                                    overflow = TextOverflow.Ellipsis,
                                    color = colors.onSurfaceVariant,
                                )
                            }
                            inner()
                        }
                    },
                )
                if (!expanded) {
                    VoiceMic(enabled = effectiveDraftingEnabled && !picking && !voice.active, onClick = ::startVoice)
                    TrailingButton(isStreaming = isStreaming, hasPayload = hasPayload && canSubmit && !picking && !voice.active,
                        onStop = onStop, onSend = ::send, sendQueues = sendQueues)
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
                            if (!savingSend) scope.launch {
                                try {
                                    draft?.key?.let { incomingShares.forgetAttachment(it, attachment.id) }
                                    attachments.removeAll { it.id == attachment.id }
                                    withContext(Dispatchers.IO) { attachment.releaseOwnedCopy() }
                                } catch (failure: Exception) {
                                    if (failure is CancellationException) throw failure
                                    pickerError = "Could not remove this saved attachment. Check storage and try again."
                                }
                            }
                        }
                    }
                }
            }

            if (expanded) Row(
                    Modifier.fillMaxWidth().padding(start = 6.dp, end = 6.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = { pickerTarget = selectionScope; photos.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) },
                        enabled = effectiveDraftingEnabled && !savingSend && !picking && !voice.active, modifier = Modifier.size(40.dp)) {
                        Icon(Icons.Outlined.Photo, "Photos")
                    }
                    IconButton(onClick = { pickerTarget = selectionScope; files.launch("*/*") }, enabled = effectiveDraftingEnabled && !savingSend && !picking && !voice.active,
                        modifier = Modifier.size(40.dp)) { Icon(Icons.Outlined.AttachFile, "Files") }
                    IconButton(onClick = {
                        try {
                            val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                            val clip = clipboard.primaryClip
                            val uris = mutableListOf<Uri>()
                            val pasted = StringBuilder()
                            if (clip != null) for (index in 0 until clip.itemCount) {
                                val item = clip.getItemAt(index)
                                val uri = item.uri
                                if (uri != null) {
                                    require(uri.scheme == "content") { "Choose this file from Files instead." }
                                    uris += uri
                                } else item.text?.let { pasted.append(it) }
                            }
                            if (pasted.isNotEmpty()) updateText(text + pasted)
                            if (uris.isNotEmpty()) loadSelection(uris, false, clip)
                        } catch (_: Exception) { pickerError = "Could not paste this item. Try choosing it from Files." }
                    }, enabled = effectiveDraftingEnabled && !savingSend && !picking && !voice.active, modifier = Modifier.size(40.dp)) {
                        Icon(Icons.Outlined.ContentPaste, "Paste")
                    }
                    Spacer(Modifier.weight(1f))
                    VoiceMic(enabled = effectiveDraftingEnabled && !picking && !voice.active, onClick = ::startVoice)
                    if (isStreaming && onStop != null && hasPayload) {
                        IconButton(onClick = ::send, enabled = canSubmit && !picking && !voice.active, modifier = Modifier.size(36.dp)) {
                            Icon(Icons.Outlined.PlaylistAdd, "Queue message")
                        }
                    }
                    TrailingButton(
                        isStreaming = isStreaming,
                        hasPayload = hasPayload && canSubmit && !picking && !voice.active,
                        onStop = onStop,
                        onSend = ::send,
                        sendQueues = sendQueues,
                    )
            }
        }
    }
    if (showAgentUsage) {
        AlertDialog(onDismissRequest = { showAgentUsage = false },
            title = { Text(agentLabel ?: "Runtime usage") },
            text = { ai.nuphos.android.ui.agent.RuntimeUsage(agentQuota) },
            confirmButton = { TextButton(onClick = { showAgentUsage = false }) { Text("Done") } })
    }
    if (showModel && modelSettings != null) ModelSettingsSheet(modelSettings, onDismiss = { showModel = false })
    if (showComputers && store != null) {
        var pending by remember(draft, store.workspaceRevision, resolvedSelection) { mutableStateOf(resolvedSelection) }
        CredentialPickerSheet(
            selection = pending,
            onSelectionChange = { pending = it },
            onDismiss = { showComputers = false },
            computersOnly = true,
            onConfirm = {
                if (effectiveDraftingEnabled && showControls) {
                    onSelectionChange?.invoke(pending) ?: store.updateCredentialSelection(pending)
                }
                showComputers = false
            },
        )
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
    sendQueues: Boolean = false,
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
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                disabledContainerColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f),
            ),
        ) {
            Icon(if (sendQueues) Icons.Outlined.PlaylistAdd else Icons.Rounded.ArrowUpward, contentDescription = if (isStreaming || sendQueues) "Queue message" else "Send", modifier = Modifier.size(18.dp))
        }
    }
}

/**
 * Mirrors iOS `ComposerAttachment`: a 64dp thumbnail with an 18dp remove disc
 * nudged past its top-end corner. The disc is a plain clickable rather than an
 * [IconButton], whose 48dp minimum touch target drew a ripple over a quarter of
 * the thumbnail; the invisible hit area is widened to 34dp instead. The tile
 * pads by the hit box's full overhang, because touches outside a parent's
 * bounds are not delivered and would otherwise shave 8dp off two sides.
 */
@Composable
private fun AttachmentTile(attachment: ComposerAttachment, onRemove: () -> Unit) {
    Box(Modifier.padding(top = RemoveBadgeHitOverhang, end = RemoveBadgeHitOverhang)) {
        AttachmentThumbnail(attachment)
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .offset(x = RemoveBadgeHitOverhang, y = -RemoveBadgeHitOverhang)
                .size(RemoveBadgeHitSize)
                .clickable(
                    interactionSource = null,
                    indication = ripple(bounded = false, radius = RemoveBadgeHitSize / 2),
                    role = Role.Button,
                    onClick = onRemove,
                ),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                Modifier.size(RemoveBadgeSize).clip(CircleShape).background(MaterialTheme.colorScheme.onSurface),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.Close, contentDescription = "Remove", tint = MaterialTheme.colorScheme.surface, modifier = Modifier.size(10.dp))
            }
        }
    }
}

private val RemoveBadgeSize = 18.dp
private val RemoveBadgeHitSize = 34.dp
/** How far the badge pokes out past the thumbnail corner. */
private val RemoveBadgeOverhang = 5.dp
/** Offset of the hit box so its centered badge lands at [RemoveBadgeOverhang]. */
private val RemoveBadgeHitOverhang = (RemoveBadgeHitSize - RemoveBadgeSize) / 2 + RemoveBadgeOverhang

@Composable
private fun AttachmentThumbnail(attachment: ComposerAttachment) {
    Box(Modifier.size(64.dp)) {
        val retainedImage = (attachment.kind as? ComposerAttachment.Kind.RetainedFile)?.takeIf { it.image }
        if (retainedImage != null) {
            coil3.compose.AsyncImage(model = retainedImage.source.file, contentDescription = attachment.name,
                modifier = Modifier.size(64.dp).clip(RoundedCornerShape(12.dp)), contentScale = ContentScale.Crop)
        } else when (val kind = attachment.kind) {
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
    }
}

internal fun selectionInput(context: android.content.Context, uri: Uri, images: Boolean): AttachmentRetention.Input {
    require(uri.scheme == "content") { "Only content-provider attachments are supported." }
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
    return AttachmentRetention.Input(name, mime, size, (images && !mime.startsWith("video/")) || mime.startsWith("image/")) {
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

internal fun loadImage(input: AttachmentRetention.Input, remaining: Long): ComposerAttachment {
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
