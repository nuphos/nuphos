package ai.nuphos.android

import ai.nuphos.android.model.ChatPart

/** Test-only permission gate for the current fixture batch. */
object ScopedFileReadApproval {
    fun permits(tool: ChatPart.Tool, team: String, groups: Set<String>, files: Set<String>): Boolean {
        val input = tool.input?.objectValue ?: return false
        if (("command" in input && "cmd" in input) || ("path" in input && "file_path" in input)) return false
        val name = tool.toolName.lowercase()
        val command = tool.command ?: tool.input["cmd"]?.stringValue
        if (command != null && name in setOf("bash", "terminal", "exec_command", "execute_command", "run_command", "shell")) {
            if (input.keys.any { it !in setOf("command", "cmd", "timeout", "yield_time_ms", "max_output_tokens", "description") }) return false
            if (!team.matches(Regex("[A-Za-z0-9_-]+"))) return false
            val teamArguments = listOf("\"" + '$' + "{TEAM:-$team}\"", "\"" + '$' + "TEAM\"", "\"$team\"", "'$team'", team)
            val pulls = groups.filter { it.matches(Regex("[a-fA-F0-9]{24}")) }.flatMap { group ->
                listOf("skills", ".claude/skills").flatMap { skill -> teamArguments.map { argument -> "bash $skill/file-transfer/scripts/transfer-pull.sh $argument $group ./uploads" } }
            }
            if (command.trim() in pulls) return true
            if (pulls.any { pull -> files.any { file -> command.trim() == "$pull && cat $file" || command.trim() == "$pull && cat \"$file\"" } }) return true
            if (command.trim() in listOf("ls ./uploads", "ls -l ./uploads", "ls -la ./uploads")) return true
            return files.any { command.trim() == "cat $it" || command.trim() == "cat \"$it\"" }
        }
        if (name !in setOf("read", "read_file", "view_image", "open_image", "read_image")) return false
        if (input.keys.any { it !in setOf("path", "file_path", "offset", "limit") }) return false
        val path = tool.input["path"]?.stringValue ?: tool.input["file_path"]?.stringValue ?: return false
        return path in files
    }
}
