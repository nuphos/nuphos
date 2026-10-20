package ai.nuphos.android.model

/** A display projection only. The original parts and wire payload are never rewritten. */
data class TransferUpload(val groupId: String, val names: List<String>) {
    companion object {
        private val id = Regex("[a-fA-F0-9]{24}")
        private val instruction = Regex(
            """\[The user uploaded ([0-9]+) file\(s\) to the Nuphos file-transfer store \(transfer group ([a-fA-F0-9]{24})\): ([^\r\n]+?)\. To work with them, load the file-transfer skill and pull them into the sandbox: bash skills/file-transfer/scripts/transfer-pull\.sh "\${'$'}TEAM" \2 \./uploads](?: Open and read the pulled image files before answering image questions\.)?""",
        )

        private fun structured(part: ChatPart): TransferUpload? {
            val raw = (part as? ChatPart.Other)?.value ?: return null
            val value = if (raw["type"]?.stringValue == "data-attachment") raw["data"] ?: return null else raw
            if (value["type"]?.stringValue != "transfer-upload" ||
                (value["status"]?.stringValue ?: "ready") != "ready") return null
            val group = value["groupId"]?.stringValue?.takeIf(id::matches) ?: return null
            val files = value["files"]?.arrayValue ?: return null
            val names = files.map { it["fileName"]?.stringValue ?: return null }
            if (names.size !in 1..20 || names.any { it.isBlank() || it.length > 512 }) return null
            return TransferUpload(group, names)
        }

        data class Display(val text: String, val uploads: List<TransferUpload>)

        fun display(parts: List<ChatPart>): Display {
            val uploads = linkedMapOf<String, TransferUpload>()
            parts.mapNotNull(::structured).forEach { uploads[it.groupId] = it }
            val text = parts.filterIsInstance<ChatPart.Text>().joinToString("") { part ->
                // Generated instructions occupy their own part, or the end of a persisted
                // text part. Quoted examples, malformed IDs and ordinary prose stay intact.
                val match = instruction.find(part.text)
                if (match == null || match.range.last != part.text.lastIndex ||
                    (match.range.first > 0 && part.text[match.range.first - 1] != '\n')) return@joinToString part.text
                val count = match.groupValues[1].toIntOrNull() ?: return@joinToString part.text
                val group = match.groupValues[2]
                val names = uploads[group]?.names ?: match.groupValues[3].split(", ").let {
                    // Legacy filenames were joined without escaping commas. The API
                    // supplies authoritative names; keep the original label until it loads.
                    if (it.size == count) it else listOf(match.groupValues[3])
                }
                if (count !in 1..20 || names.any { it.isBlank() || it.length > 10_240 }) return@joinToString part.text
                uploads.putIfAbsent(group, TransferUpload(group, names))
                part.text.substring(0, match.range.first).trimEnd()
            }.trim()
            return Display(text, uploads.values.toList())
        }
    }
}
