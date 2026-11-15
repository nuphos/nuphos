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
import androidx.compose.ui.res.stringResource
import ai.nuphos.android.R

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
    val decodeFailed = stringResource(R.string.shell_desktop_decode_failed)
    DisposableEffect(desktop,lifecycle) {
        val observer=LifecycleEventObserver { _,event -> if(event==Lifecycle.Event.ON_PAUSE || event==Lifecycle.Event.ON_STOP) { desktop.stop(); foreground=false; onClose() } }
        lifecycle.addObserver(observer)
        desktop.onVideo={ w,h,bytes,flags -> decoder.frame(w,h,bytes,flags); video=true }
        onDispose { lifecycle.removeObserver(observer); desktop.onVideo=null; desktop.stop(); decoder.surface(null) }
    }
    LaunchedEffect(desktop,valid) { if(valid)desktop.start() else { desktop.stop(); onClose() } }
    LaunchedEffect(decoder) { withContext(Dispatchers.IO) { while(isActive) { if(recovery.tick()) withContext(Dispatchers.Main) { video=false; desktop.fail(decodeFailed) }; delay(16) } } }
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false)) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().systemBarsPadding().padding(12.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                    Text(stringResource(R.string.shell_desktop),Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
                    TextButton(onClick=onClose) { Text(stringResource(R.string.shell_close)) }
                }
                Text(when(desktop.phase) {
                    DesktopSession.Phase.Connecting -> stringResource(R.string.shell_desktop_connecting)
                    DesktopSession.Phase.Live -> if(desktop.controlling) { if(desktop.display==0) stringResource(R.string.shell_desktop_mac_shared) else stringResource(R.string.shell_desktop_in_control) } else stringResource(R.string.shell_desktop_watching)
                    DesktopSession.Phase.Failed -> desktop.error ?: stringResource(R.string.shell_desktop_failed)
                    DesktopSession.Phase.Closed -> stringResource(R.string.shell_desktop_closed)
                })
                DesktopCanvas(desktop,decoder,video)
                Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    Button(onClick={ desktop.control(!desktop.controlling) },enabled=desktop.phase==DesktopSession.Phase.Live) { Text(stringResource(if(desktop.controlling) R.string.shell_desktop_hand_back else R.string.shell_desktop_take_over)) }
                    if(desktop.phase==DesktopSession.Phase.Failed) OutlinedButton(onClick={ recovery.reset(); video=false; desktop.retry() }) { Text(stringResource(R.string.shell_retry)) }
                }
                if(desktop.controlling) DesktopKeyboard(desktop)
            }
        }
    }
}

@Composable
private fun DesktopCanvas(session: DesktopSession,decoder: DesktopVideo,video: Boolean) {
    var size by remember { mutableStateOf(IntSize.Zero) }
    val pictureLabel=stringResource(R.string.shell_desktop_picture)
    var x by remember { mutableFloatStateOf(0f) }; var y by remember { mutableFloatStateOf(0f) }
    val ratio=if(session.width>0 && session.height>0)session.width.toFloat()/session.height else 1.6f
    fun move(px: Float,py: Float,mask: Int) { if(size.width>0 && size.height>0) { x=px/size.width*session.width; y=py/size.height*session.height; session.pointer(x,y,mask) } }
    val image=remember(session.picture) { session.picture?.let { Bitmap.createBitmap(it,session.width,session.height,Bitmap.Config.ARGB_8888).asImageBitmap() } }
    Box(Modifier.fillMaxWidth().aspectRatio(ratio).background(Color.Black).onSizeChanged { size=it }
        .semantics { contentDescription=pictureLabel }
        .pointerInput(session,session.controlling) { detectTapGestures(onTap={ if(session.controlling) { move(it.x,it.y,1); move(it.x,it.y,0) } },onLongPress={ if(session.controlling) { move(it.x,it.y,4); move(it.x,it.y,0) } }) }
        .pointerInput(session,session.controlling) { detectDragGestures(onDragStart={ move(it.x,it.y,1) },onDragEnd={ session.pointer(x,y,0) },onDragCancel={ session.pointer(x,y,0) }) { change,_ -> change.consume(); move(change.position.x,change.position.y,1) } }) {
        if(image!=null && !video) Image(image,stringResource(R.string.shell_desktop_frame),Modifier.fillMaxSize())
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
    Text(stringResource(R.string.shell_desktop_keyboard_help),style=MaterialTheme.typography.bodySmall)
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
        for((label,mask) in listOf(stringResource(R.string.shell_desktop_scroll_up) to 8,stringResource(R.string.shell_desktop_scroll_down) to 16)) OutlinedButton(onClick={ session.pointer(session.width/2f,session.height/2f,mask); session.pointer(session.width/2f,session.height/2f,0) }) { Text(label) }
    }
    OutlinedTextField(input,onValueChange={ input=it },label={ Text(stringResource(R.string.shell_desktop_type_on)) },modifier=Modifier.fillMaxWidth())
    Button(enabled=!session.typing && input.composition==null && input.text.isNotEmpty() && input.text.length<=4096,
        onClick={ if(session.type(input.text)) input=TextFieldValue() }) { Text(stringResource(if(session.typing) R.string.shell_desktop_typing else R.string.shell_desktop_type)) }
}
