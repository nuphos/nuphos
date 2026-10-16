package ai.nuphos.android.data

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

class DraftBackupRulesTest {
    @Test fun privateDraftsAreExcludedFromEveryBackupAndTransferChannel() {
        val factory = DocumentBuilderFactory.newInstance()
        for ((file, channels) in mapOf(
            "data_extraction_rules.xml" to listOf("cloud-backup", "device-transfer"),
            "backup_rules.xml" to listOf("full-backup-content"),
        )) {
            val doc = factory.newDocumentBuilder().parse(File("src/main/res/xml/$file"))
            for (channel in channels) {
                val exclusions = (doc.getElementsByTagName(channel).item(0) as org.w3c.dom.Element).getElementsByTagName("exclude")
                assertTrue("Drafts must not leave the device through $file/$channel", (0 until exclusions.length).any {
                    val node = exclusions.item(it) as org.w3c.dom.Element
                    node.getAttribute("domain") == "sharedpref" && node.getAttribute("path") == "nuphos.composer-drafts.xml"
                })
            }
        }
    }
}
