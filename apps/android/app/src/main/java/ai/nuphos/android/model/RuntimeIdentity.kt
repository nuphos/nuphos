package ai.nuphos.android.model

object RuntimeIdentity {
    fun logo(provider: String?): String? = when (provider) {
        "codex" -> "openai"; "claude-code" -> "claude"; "grok" -> "grok"
        "opencode" -> "opencode"; "antigravity" -> "antigravity"; else -> null
    }
    fun name(provider: String?): String = when (provider) {
        "codex" -> "Codex"; "claude-code" -> "Claude Code"; "grok" -> "Grok Build"
        "opencode" -> "OpenCode"; "antigravity" -> "Antigravity"; "nuphos" -> "Nuphos"
        null, "" -> "Runtime"; else -> "Unknown runtime"
    }
    fun detail(provider: String?, instance: String?): String =
        listOf(name(provider), instance?.takeIf { it.isNotBlank() && it != name(provider) }).filterNotNull().joinToString(" · ")
    fun originalColor(provider: String?) = provider == "claude-code"
}
