package ai.nuphos.android

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Consent, deletion and terms statements stay in English until a native speaker confirms each
 * language (#3031). Put a key in [REVIEWED] together with its reviewed translations.
 */
class LegalTextTest {
    private val legal = listOf(
        "shell_terms_agreement", "shell_terms_of_service", "shell_privacy_policy",
        "profile_consent_intro", "profile_consent_recipients_body", "profile_consent_choice_body",
        "profile_deletion_body", "profile_deletion_request_note", "profile_deletion_saved", "profile_withdraw_body",
        "shell_voice_prompt_help",
    )
    private val REVIEWED = emptySet<String>()
    private val values = File(System.getProperty("nuphos.strings")!!)

    @Test fun unreviewedLegalTextIsEnglishOnly() {
        val english = values.listFiles()!!.joinToString("") { it.readText() }
        val locales = values.parentFile!!.listFiles { dir -> dir.name.startsWith("values-") }!!
            .flatMap { dir -> dir.listFiles()!!.map { it to it.readText() } }
        for (key in legal - REVIEWED) {
            assertTrue("$key must be translatable=\"false\" until reviewed",
                Regex("""<string name="$key" translatable="false">""").containsMatchIn(english))
            locales.forEach { (file, text) ->
                assertTrue("$key is translated in ${file.parentFile.name} before review", "name=\"$key\"" !in text)
            }
        }
    }
}
