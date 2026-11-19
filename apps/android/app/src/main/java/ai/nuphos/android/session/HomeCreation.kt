package ai.nuphos.android.session

import ai.nuphos.android.data.AgentRuntime

/** New Task may repair an unavailable remembered choice; New Bot must use that exact choice. */
object HomeCreation {
    fun canStart(runtimes: List<AgentRuntime>?) = runtimes?.any { it.selectable } == true
    fun botRuntime(runtimes: List<AgentRuntime>?, selectedId: String?): AgentRuntime? {
        val ready = runtimes.orEmpty().filter { it.selectable }
        return if (selectedId != null) ready.firstOrNull { it.id == selectedId }
            else ready.firstOrNull { it.kind == "managed" } ?: ready.firstOrNull()
    }
}
