package ai.nuphos.android.ui.chats

import ai.nuphos.android.model.CredentialSelection
import ai.nuphos.android.session.BotQuestion
import ai.nuphos.android.session.OpenQuestions
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.chat.CredentialPickerSheet
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch

/**
 * An integration card's "Choose credentials", the same in the Inbox and a Bot's chat: the member's own
 * credentials are added as named, with no picker; otherwise the asking conversation's picker, offering only
 * the providers the question asks for. Cancel or a swipe leaves the conversation as it was; Done saves the
 * selection, and the server answers the question it covers, or the card says why not.
 */
@Composable
fun rememberQuestionConnect(open: OpenQuestions?, allowed: () -> Boolean): (BotQuestion) -> Unit {
    val scope = rememberCoroutineScope()
    val store = LocalAgentStore.current
    // The question whose conversation's credentials are being chosen, with its selection as edited in the picker.
    var connecting by remember { mutableStateOf<BotQuestion?>(null) }
    var selection by remember { mutableStateOf(CredentialSelection()) }
    connecting?.let { question ->
        CredentialPickerSheet(selection, onSelectionChange = { selection = it }, onDismiss = { connecting = null },
            providers = question.request.providers, onConfirm = {
                connecting = null
                if (open != null && allowed()) scope.launch { open.select(selection, question) }
            })
    }
    return { question ->
        if (open != null) scope.launch {
            val own = question.personalCredentials
            if (own != null) {
                store.loadCredentialOptions()
                val connected = store.credentialCatalog?.allItems
                    ?.filter { it.provider.selectionKey == "personalCredentialIds" }?.map { it.id }?.toSet()
                if (allowed()) open.useOwn(own, question, connected)
            } else open.storedSelection(question)?.let { selection = it; connecting = question }
        }
    }
}
