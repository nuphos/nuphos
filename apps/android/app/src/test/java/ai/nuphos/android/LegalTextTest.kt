package ai.nuphos.android

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Consent, deletion and terms statements ship in English except in the languages a native speaker
 * confirmed (#3031). Add a locale to [REVIEWED] together with its translation of every key.
 */
class LegalTextTest {
    private val legal = listOf(
        "shell_terms_agreement", "shell_terms_of_service", "shell_privacy_policy",
        "profile_consent_intro", "profile_consent_recipients_body", "profile_consent_choice_body",
        "profile_deletion_body", "profile_deletion_request_note", "profile_deletion_saved", "profile_withdraw_body",
        "shell_voice_prompt_help",
    )
    private val REVIEWED = setOf("values-zh-rTW", "values-zh-rCN")
    private val values = File(System.getProperty("nuphos.strings")!!)

    @Test fun legalTextIsTranslatedOnlyInReviewedLanguages() {
        val locales = values.parentFile!!.listFiles { dir -> dir.name.startsWith("values-") }!!
        for (dir in locales) {
            val text = dir.listFiles()!!.joinToString("") { it.readText() }
            for (key in legal) {
                val translated = "name=\"$key\"" in text
                assertEquals("$key translated in ${dir.name}", dir.name in REVIEWED, translated)
            }
        }
    }
}
