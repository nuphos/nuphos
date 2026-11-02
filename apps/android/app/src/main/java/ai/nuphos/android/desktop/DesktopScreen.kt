package ai.nuphos.android.desktop

import android.graphics.Bitmap
import android.view.Surface
import android.view.TextureView
import android.graphics.SurfaceTexture
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import ai.nuphos.android.session.ChatSession
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.ui.LocalAuthSession
import kotlinx.coroutines.*

@Composable
internal fun DesktopScreen(chat: ChatSession,store: AgentStore,onClose: () -> Unit) {
    val auth=LocalAuthSession.current; val scope=rememberCoroutineScope(); val lifecycle=LocalLifecycleOwner.current.lifecycle
    val token=auth.token ?: return; val account=auth.user?.id ?: return
    val authRevision=auth.generation; val workspaceRevision=store.workspaceRevision
    val consentRevision=ai.nuphos.android.session.AiAccess.revision
    var foreground by remember { mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
    val valid by rememberUpdatedState(auth.aiAllowed && chat.canOpenDesktop && auth.user?.id==account && auth.token==token &&
        auth.generation==authRevision && store.selectedTeam?.id==chat.teamId && store.workspaceRevision==workspaceRevision &&
        ai.nuphos.android.session.AiAccess.revision==consentRevision && foreground)
    val desktop=remember(chat,account,token,authRevision,workspaceRevision,consentRevision) {
        DesktopSession(token,chat.teamId,chat.sessionId,scope,{ valid && auth.token==token && auth.user?.id==account &&
            auth.generation==authRevision && store.workspaceRevision==workspaceRevision && store.selectedTeam?.id==chat.teamId &&
            ai.nuphos.android.session.AiAccess.revision==consentRevision && auth.aiAllowed && chat.canOpenDesktop })
    }
    val decoder=remember(desktop) { DesktopVideo() }
    val recovery=remember(decoder) { DesktopDecodeRecovery(decoder::drain,decoder::close) }
    var video by remember(desktop) { mutableStateOf(false) }
    DisposableEffect(desktop,lifecycle) {
        val observer=LifecycleEventObserver { _,event -> if(event==Lifecycle.Event.ON_PAUSE || event==Lifecycle.Event.ON_STOP) { desktop.stop(); foreground=false; onClose() } }
        lifecycle.addObserver(observer)
        desktop.onVideo={ w,h,bytes,flags -> decoder.frame(w,h,bytes,flags); video=true }
        onDispose { lifecycle.removeObserver(observer); desktop.onVideo=null; desktop.stop(); decoder.surface(null) }
    }
    LaunchedEffect(desktop,valid) { if(valid)desktop.start() else { desktop.stop(); onClose() } }
    LaunchedEffect(decoder) { withContext(Dispatchers.IO) { while(isActive) { if(recovery.tick()) withContext(Dispatchers.Main) { video=false; desktop.fail("Could not decode this desktop. Retry to start a fresh connection.") }; delay(16) } } }
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false)) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().systemBarsPadding().padding(12.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                    Text("Desktop",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
                    TextButton(onClick=onClose) { Text("Close") }
                }
                Text(when(desktop.phase) {
                    DesktopSession.Phase.Connecting -> "Connecting…"
                    DesktopSession.Phase.Live -> if(desktop.controlling) { if(desktop.display==0) "You have the Mac’s screen; the agent can still use it too." else "You have control. Hand back to let the agent use this desktop." } else "Watching. Take over to use the pointer and keyboard."
                    DesktopSession.Phase.Failed -> desktop.error ?: "Desktop connection failed."
                    DesktopSession.Phase.Closed -> "Desktop closed."
                })
                DesktopCanvas(desktop,decoder,video)
                Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    Button(onClick={ desktop.control(!desktop.controlling) },enabled=desktop.phase==DesktopSession.Phase.Live) { Text(if(desktop.controlling) "Hand back" else "Take over") }
                    if(desktop.phase==DesktopSession.Phase.Failed) OutlinedButton(onClick={ recovery.reset(); video=false; desktop.retry() }) { Text("Retry") }
                }
                if(desktop.controlling) DesktopKeyboard(desktop)
            }
        }
    }
}

@Composable
private fun DesktopCanvas(session: DesktopSession,decoder: DesktopVideo,video: Boolean) {
    var size by remember { mutableStateOf(IntSize.Zero) }
    var x by remember { mutableFloatStateOf(0f) }; var y by remember { mutableFloatStateOf(0f) }
    val ratio=if(session.width>0 && session.height>0)session.width.toFloat()/session.height else 1.6f
    fun move(px: Float,py: Float,mask: Int) { if(size.width>0 && size.height>0) { x=px/size.width*session.width; y=py/size.height*session.height; session.pointer(x,y,mask) } }
    val image=remember(session.picture) { session.picture?.let { Bitmap.createBitmap(it,session.width,session.height,Bitmap.Config.ARGB_8888).asImageBitmap() } }
    Box(Modifier.fillMaxWidth().aspectRatio(ratio).background(Color.Black).onSizeChanged { size=it }
        .semantics { contentDescription="Remote desktop picture" }
        .pointerInput(session,session.controlling) { detectTapGestures(onTap={ if(session.controlling) { move(it.x,it.y,1); move(it.x,it.y,0) } },onLongPress={ if(session.controlling) { move(it.x,it.y,4); move(it.x,it.y,0) } }) }
        .pointerInput(session,session.controlling) { detectDragGestures(onDragStart={ move(it.x,it.y,1) },onDragEnd={ session.pointer(x,y,0) },onDragCancel={ session.pointer(x,y,0) }) { change,_ -> change.consume(); move(change.position.x,change.position.y,1) } }) {
        if(image!=null && !video) Image(image,"Remote desktop frame",Modifier.fillMaxSize())
        AndroidView(factory={ context -> TextureView(context).apply {
            surfaceTextureListener=object: TextureView.SurfaceTextureListener {
                private var output: Surface?=null
                override fun onSurfaceTextureAvailable(texture: SurfaceTexture,w: Int,h: Int) { output=Surface(texture); decoder.surface(output); session.keyframe() }
                override fun onSurfaceTextureSizeChanged(texture: SurfaceTexture,w: Int,h: Int)=Unit
                override fun onSurfaceTextureUpdated(texture: SurfaceTexture)=Unit
                override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean { decoder.surface(null); output?.release(); output=null; return true }
            }
        } },update={ it.alpha=if(video)1f else 0f },modifier=Modifier.fillMaxSize())
    }
}

@Composable
private fun DesktopKeyboard(session: DesktopSession) {
    var input by remember(session) { mutableStateOf(TextFieldValue()) }
    var modifiers by remember(session.controlling) { mutableStateOf(setOf<Int>()) }
    Text("Tap to click, hold to right-click, or drag the picture. Compose text below, then tap Type to send it to this desktop.",style=MaterialTheme.typography.bodySmall)
    Row(horizontalArrangement=Arrangement.spacedBy(4.dp)) {
        for((label,code) in listOf("Esc" to 0xff1b,"Tab" to 0xff09,"⌫" to 0xff08,"Enter" to 0xff0d)) OutlinedButton(onClick={ session.key(code) },contentPadding=PaddingValues(8.dp)) { Text(label) }
    }
    Row(horizontalArrangement=Arrangement.spacedBy(4.dp)) {
        for((label,code) in listOf("Ctrl" to 0xffe3,"Alt" to 0xffe9,"Shift" to 0xffe1,"⌘" to 0xffeb)) FilterChip(selected=code in modifiers,onClick={ val down=code !in modifiers; session.modifier(code,down); modifiers=if(down)modifiers+code else modifiers-code },label={ Text(label) })
    }
    Row(horizontalArrangement=Arrangement.spacedBy(4.dp)) {
        for((label,code) in listOf("←" to 0xff51,"↑" to 0xff52,"↓" to 0xff54,"→" to 0xff53)) OutlinedButton(onClick={ session.key(code) },contentPadding=PaddingValues(8.dp)) { Text(label) }
    }
    Row(horizontalArrangement=Arrangement.spacedBy(4.dp)) {
        for((label,mask) in listOf("Scroll up" to 8,"Scroll down" to 16)) OutlinedButton(onClick={ session.pointer(session.width/2f,session.height/2f,mask); session.pointer(session.width/2f,session.height/2f,0) }) { Text(label) }
    }
    OutlinedTextField(input,onValueChange={ input=it },label={ Text("Type on desktop") },modifier=Modifier.fillMaxWidth())
    Button(enabled=!session.typing && input.composition==null && input.text.isNotEmpty() && input.text.length<=4096,
        onClick={ if(session.type(input.text)) input=TextFieldValue() }) { Text(if(session.typing) "Typing…" else "Type") }
}
