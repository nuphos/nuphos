package ai.nuphos.android.ui.chat

import ai.nuphos.android.data.AttachmentTransfers.Progress
import ai.nuphos.android.data.AttachmentTransfers.Stage
import org.junit.Assert.assertEquals
import org.junit.Test

class UploadLineTest {
    @Test fun onceEveryByteIsOutTheMessageReadsAsSending() {
        assertEquals(UploadLine.Sending, uploadLine(Progress(Stage.Finalizing, filesSent = true)))
    }

    @Test fun theOtherStagesKeepTheirWords() {
        assertEquals(UploadLine.Preparing, uploadLine(Progress(Stage.Intent)))
        assertEquals(UploadLine.Uploading, uploadLine(Progress(Stage.Uploading, "a1", 1, 2)))
        // A retried upload checks the group before sending anything.
        assertEquals(UploadLine.Checking, uploadLine(Progress(Stage.Finalizing)))
        assertEquals(UploadLine.Ready, uploadLine(Progress(Stage.Ready, filesSent = true)))
    }
}
