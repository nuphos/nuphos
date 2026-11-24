package ai.nuphos.android.session

import ai.nuphos.android.data.AgentRuntime

/**
 * New Task may repair an unavailable remembered choice. New Bot never moves to another runtime on its own:
 * with no [botRuntime], it asks for one before it creates (#3947).
 */
object HomeCreation {
    fun canStart(runtimes: List<AgentRuntime>?) = runtimes?.any { it.selectable } == true
    fun botRuntime(runtimes: List<AgentRuntime>?, selectedId: String?): AgentRuntime? {
        val ready = runtimes.orEmpty().filter { it.selectable }
        return if (selectedId != null) ready.firstOrNull { it.id == selectedId }
            else ready.firstOrNull { it.kind == "managed" } ?: ready.firstOrNull()
    }
}
