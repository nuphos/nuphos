package ai.nuphos.android.desktop

/** A broken codec is drained once, released once, and stays stopped until explicit retry. */
internal class DesktopDecodeRecovery(private val drain: () -> Unit, private val close: () -> Unit) {
    private var failed=false
    @Synchronized fun tick(): Boolean {
        if(failed)return false
        return try { drain(); false } catch(_: Exception) { failed=true; runCatching(close); true }
    }
    @Synchronized fun reset() { close(); failed=false }
}
