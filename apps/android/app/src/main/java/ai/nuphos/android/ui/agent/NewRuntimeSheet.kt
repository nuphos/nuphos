package ai.nuphos.android.ui.agent

import ai.nuphos.android.R
import ai.nuphos.android.data.*
import ai.nuphos.android.session.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NewRuntimeSheet(store: NewRuntimeStore, setup: RuntimeSetupStore) {
    val runtime = store.runtime
    if (runtime != null) {
        RuntimeSetupSheet(setup, onDismiss = store::cancel, initialManaging = true,
            initialSignInRuntimeId = runtime.id, inventoryMode = true, devices = listOf(store.device),
            dismissEnabled = !store.busy, externalError = store.error, onConnected = store::complete)
    } else ModalBottomSheet(onDismissRequest = { if (!store.busy) store.cancel() },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        properties = ModalBottomSheetProperties(shouldDismissOnBackPress = !store.busy),
        containerColor = MaterialTheme.colorScheme.background) {
        RuntimePickerHeader(stringResource(R.string.new_runtime_title), onClose = { if (!store.busy) store.cancel() })
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (store.provider == null) {
                Text(store.device.label, style = MaterialTheme.typography.titleMedium)
                NewRuntime.providers.forEach { provider ->
                    val action = store.action(provider) ?: return@forEach
                    OutlinedButton(onClick = { store.choose(provider) },
                        modifier = Modifier.fillMaxWidth().testTag("new-runtime-provider-$provider")) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            ai.nuphos.android.ui.components.RuntimeMark(provider, 30.dp)
                            Column {
                                val label = inventoryProviderName(provider)
                                Text(when {
                                    action is NewRuntime.Action.SignIn -> stringResource(R.string.new_runtime_sign_in, label)
                                    provider in NewRuntime.previews -> stringResource(R.string.new_runtime_preview, label)
                                    else -> label
                                })
                            }
                        }
                    }
                }
            } else {
                Text(inventoryProviderName(requireNotNull(store.provider)), style = MaterialTheme.typography.titleMedium)
                Text(stringResource(R.string.new_runtime_on_computer, store.device.label))
                OutlinedTextField(store.name, { if (store.canEditName) store.name = it }, enabled = store.canEditName,
                    label = { Text(stringResource(R.string.new_runtime_name)) }, singleLine = true,
                    isError = store.nameTaken, modifier = Modifier.fillMaxWidth().testTag("new-runtime-name"))
                Text(stringResource(if (store.nameTaken) R.string.new_runtime_name_taken else R.string.new_runtime_name_help))
                Button(onClick = store::create, enabled = store.canCreate, modifier = Modifier.testTag("new-runtime-continue")) { Text(stringResource(R.string.agent_continue)) }
            }
            if (store.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            store.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
}
