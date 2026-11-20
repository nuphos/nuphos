package ai.nuphos.android

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.model.CredentialRef
import ai.nuphos.android.model.DecisionQuestion
import ai.nuphos.android.model.FormField
import ai.nuphos.android.model.InputRequest
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Runs both serializers on-device with the same fictional multi-target, long-title payload. */
@RunWith(AndroidJUnit4::class)
class DecisionWireDeviceTest {
    @Test fun preservesMultipleRecipientsAndALongTitle() {
        val payload = """{"id":"release","question":"Publish?","aboutConversations":[
            {"sessionId":"writer","title":"Release writer"},
            {"sessionId":"checker","title":"Release checker for documentation and deployment notes with an intentionally long conversation title"}
        ]}"""
        val expected = Http.json.parseToJsonElement(payload).jsonObject["aboutConversations"]
        val original = Http.json.encodeToString(Http.json.decodeFromString<OriginalInputRequest>(payload))
        val current = Http.json.encodeToString(Http.json.decodeFromString<InputRequest>(payload))
        fun preservesRecipients(encoded: String) {
            assertEquals(expected, Http.json.parseToJsonElement(encoded).jsonObject["aboutConversations"])
        }
        // The identical assertion must be red with the original decoder and green with the fix.
        val red = assertThrows(AssertionError::class.java) { preservesRecipients(original) }
        assertNull(Http.json.parseToJsonElement(original).jsonObject["aboutConversations"])
        preservesRecipients(current)
        val report = """
            baseline source: abd48e220a7dcc6864f80022bcc7f1763d9befef ConversationModels.kt InputRequest
            method: original declaration copied verbatim below, renamed only; shared production Http.json
            baseline: RED (expected assertion failure: ${red.message})
            baseline encoded: $original
            current: GREEN (same assertion, both IDs and complete titles retained)
            current encoded: $current
        """.trimIndent()
        Log.i("DecisionWireBaseline", report)
        val args = InstrumentationRegistry.getArguments()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val folder = args.getString("additionalTestOutputDir")?.let(::File)
            ?: File(context.externalMediaDirs.first(), "additional_test_output")
        folder.mkdirs()
        File(folder, "decision-wire-red-green.txt").writeText(report)
    }
}

// Original declaration from abd48e2, renamed only so both native serializers run in one APK.
@Serializable
data class OriginalInputRequest(
    val id: String,
    val category: String? = null,
    val question: String = "",
    val options: List<String>? = null,
    /** ISO time it was asked. */
    val askedAt: String? = null,
    /** Markdown the agent wrote to decide from: context, findings, links, risks. */
    val body: String? = null,
    /** The plan an approval decides: answered with its Approve or Reject, never in words. */
    val planId: String? = null,
    /** An integration question's providers (any access answers it), or the exact credentials it names. */
    val providers: List<String>? = null,
    val credentials: List<CredentialRef>? = null,
    /** A secret only the user can type, in its masked card in the conversation that asked. */
    val secretName: String? = null,
    /** A web form's details asked together in that card, and the site they are entered on. */
    val fields: List<FormField>? = null,
    val site: String? = null,
    /** Any number of [options] may be picked. */
    val multiSelect: Boolean? = null,
    /** Related questions answered together; [question] is their headline. */
    val questions: List<DecisionQuestion>? = null,
    /** ISO time its owner snoozed it until: out of their Inbox till then, still open where it was asked. */
    val snoozedUntil: String? = null,
)
