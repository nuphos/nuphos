package ai.nuphos.android.ui.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.Canvas
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import ai.nuphos.android.R
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.agent.NewTaskComposer

internal val LocalNewTaskRequest = staticCompositionLocalOf<(() -> Unit)?> { null }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewTaskLauncher(nav: NavHostController) {
    val store = LocalAgentStore.current
    val request = LocalNewTaskRequest.current
    val latestRequest by rememberUpdatedState(request)
    val auth = LocalAuthSession.current
    var openLocal by rememberSaveable(auth.user?.id, store.selectedTeam?.id) { mutableStateOf(false) }
    fun launch() { latestRequest?.invoke() ?: run { openLocal = true } }
    LaunchedEffect(request != null, openLocal) { if (request != null && openLocal) { request.invoke(); openLocal = false } }
    val app = LocalContext.current.applicationContext as ai.nuphos.android.NuphosApplication
    val shared by app.incomingShares.state.collectAsState()
    LaunchedEffect(shared?.id, shared?.destination) {
        if (shared?.destination?.destination == ai.nuphos.android.session.ComposerDrafts.Destination.NewChat) launch()
    }
    FilledTonalButton(onClick = ::launch, modifier = Modifier.fillMaxWidth().padding(16.dp).testTag("new-task-open")) {
        Text(stringResource(R.string.new_task_title))
    }
    if (openLocal && request == null) NewTaskSheet(nav) { openLocal = false }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NewTaskSheet(nav: NavHostController, onDismiss: () -> Unit) {
    val auth = LocalAuthSession.current
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        modifier = Modifier.fillMaxHeight(0.92f).testTag("new-task-sheet"),
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.new_task_title), style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            TextButton(onClick = onDismiss, modifier = Modifier.testTag("new-task-cancel")) { Text(stringResource(R.string.new_task_cancel)) }
        }
        Column(Modifier.fillMaxWidth().weight(1f).padding(24.dp), verticalArrangement = Arrangement.Center) {
            val firstName = auth.user?.name.orEmpty().trim().split(' ', '\t', '\n').firstOrNull().orEmpty()
            Canvas(Modifier.size(36.dp)) {
                val x = size.width / 24f
                val y = size.height / 24f
                val star = Path().apply {
                    moveTo(12*x, 0f)
                    cubicTo(12*x, 6.6f*y, 17.4f*x, 12*y, 24*x, 12*y)
                    cubicTo(17.4f*x, 12*y, 12*x, 17.4f*y, 12*x, 24*y)
                    cubicTo(12*x, 17.4f*y, 6.6f*x, 12*y, 0f, 12*y)
                    cubicTo(6.6f*x, 12*y, 12*x, 6.6f*y, 12*x, 0f)
                    close()
                }
                drawPath(star, Brush.sweepGradient(listOf(Color(0xffff80c0), Color(0xff9966ff), Color.Cyan, Color(0xffff80c0), Color.Yellow, Color(0xffff80c0))))
                scale(0.72f) {
                    drawPath(star, Brush.radialGradient(listOf(Color.White, Color(0xfff5f2ff), Color(0xffede8ff))))
                }
            }
            Spacer(Modifier.height(20.dp))
            Text(if (firstName.isEmpty()) stringResource(R.string.new_task_welcome)
                else stringResource(R.string.new_task_welcome_name, firstName), style = MaterialTheme.typography.headlineSmall)
        }
        NewTaskComposer(nav, onSubmitted = onDismiss)
    }
}
