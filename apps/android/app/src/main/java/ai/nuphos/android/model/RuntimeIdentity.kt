package ai.nuphos.android.model

import ai.nuphos.android.R

object RuntimeIdentity {
    fun logo(provider: String?): String? = when (provider) {
        "codex" -> "openai"; "claude-code" -> "claude"; "grok" -> "grok"
        "opencode" -> "opencode"; "antigravity" -> "antigravity"; "dsh" -> "deepseek"; "hermes" -> "hermes"; "pi" -> "pi"; else -> null
    }
    fun name(provider: String?): String = when (provider) {
        "codex" -> "Codex"; "claude-code" -> "Claude Code"; "grok" -> "Grok Build"
        "opencode" -> "OpenCode"; "antigravity" -> "Antigravity"; "hermes" -> "Hermes Agent"; "dsh" -> "DeepSeek Harness"; "pi" -> "Pi"; "nuphos" -> "Nuphos"
        null, "" -> Words(R.string.agent_runtime); else -> Words(R.string.storetext_runtime_unknown)
    }
    fun detail(provider: String?, instance: String?): String =
        listOf(name(provider), instance?.takeIf { it.isNotBlank() && it != name(provider) }).filterNotNull().joinToString(" · ")
    fun originalColor(provider: String?) = provider == "claude-code"
}
