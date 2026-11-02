package ai.nuphos.android.data

import org.junit.Assert.*
import org.junit.Test

class ServerQueueContractTest {
    @Test fun listKeepsOrderAndDefaultsUnknownOwnershipToFalse() {
        val result = AgentChatApi.decodeQueue("""{"messages":[{"id":"a","mine":true,"text":"first"},{"id":"b","text":"unknown"}]}""")
        assertEquals(listOf("a", "b"), result.map { it.id })
        assertTrue(result.first().mine); assertFalse(result.last().mine)
    }
    @Test fun recallUsesOriginalPartsAndPreservesInlineFiles() {
        val result = AgentChatApi.decodeQueueRecall("""{"ok":true,"text":"rendered envelope","message":{"parts":[{"type":"text","text":"my text"},{"type":"file","mediaType":"image/jpeg","filename":"photo.jpg","url":"data:image/jpeg;base64,YWJj"}]}}""")
        assertEquals("my text", result.text)
        assertEquals("photo.jpg", result.files.single().filename)
        assertEquals("data:image/jpeg;base64,YWJj", result.files.single().url)
    }
    @Test fun oldTextOnlyReceiptStillWorks() {
        val result = AgentChatApi.decodeQueueRecall("""{"ok":true,"text":"old message"}""")
        assertEquals("old message", result.text); assertTrue(result.files.isEmpty())
    }
    @Test fun malformedReceiptCannotBecomeAnEmptySuccessfulRecall() {
        for (json in listOf("{}", """{"ok":false,"text":"bad"}""", """{"ok":true}""")) {
            try { AgentChatApi.decodeQueueRecall(json); fail("Expected malformed receipt to fail") }
            catch (_: NuphosApi.Failure.InvalidResponse) { }
        }
    }
}
