package ai.nuphos.android.session

import org.junit.Assert.*
import org.junit.Test

class ComposerDraftsTest {
    @Test fun destinationsPreserveWhitespaceAcrossRebinding() {
        val store = ComposerDrafts()
        val first = store.bind("a", "t", ComposerDrafts.Destination.Chat("one"))!!
        val second = store.bind("a", "t", ComposerDrafts.Destination.Chat("two"))!!
        val fresh = store.bind("a", "t", ComposerDrafts.Destination.NewChat)!!
        first.write("  A\n "); second.write("B"); fresh.write("new")
        assertEquals("  A\n ", store.bind("a", "t", ComposerDrafts.Destination.Chat("one"))!!.text)
        assertEquals("B", second.text)
        assertEquals("new", fresh.text)
        assertEquals("", store.bind("a", "other", ComposerDrafts.Destination.Chat("one"))!!.text)
        assertNull(store.bind("a", null, ComposerDrafts.Destination.NewChat))
        assertEquals("", ComposerDrafts().bind("a", "t", ComposerDrafts.Destination.NewChat)!!.text)
    }
    @Test fun replacementAndClearFenceLateWrites() {
        val store = ComposerDrafts()
        val old = store.bind("a", "t", ComposerDrafts.Destination.NewChat)!!
        old.write("secret")
        store.onIdentity("b")
        assertFalse(old.write("late"))
        val current = store.bind("b", "t", ComposerDrafts.Destination.NewChat)!!
        assertEquals("", current.text)
        current.write("next"); store.clear()
        assertFalse(current.write("late"))
        assertEquals("", store.bind("b", "t", ComposerDrafts.Destination.NewChat)!!.text)
    }
    @Test fun oldIdentityCannotBindAndUnresolvedConsentSuspendsLease() {
        val store = ComposerDrafts()
        store.onIdentity("a")
        var allowed = true
        val lease = store.bind("a", "t", ComposerDrafts.Destination.NewChat) { allowed }!!
        lease.write("private")
        allowed = false
        assertFalse(lease.write("late"))
        assertEquals("", lease.text)
        allowed = true
        assertEquals("private", lease.text)
        store.onIdentity("b")
        assertNull(store.bind("a", "t", ComposerDrafts.Destination.NewChat))
        store.onIdentity(null)
        assertNull(store.bind("a", "t", ComposerDrafts.Destination.NewChat))
    }
    @Test fun revokedConsentCannotReenableOldLeaseWhenConsentReturns() {
        AiAccess.activate("draft-token"); AiAccess.grant("draft-token")
        val store = ComposerDrafts()
        val lease = store.bind("a", "t", ComposerDrafts.Destination.NewChat, AiAccess.bind("draft-token"))!!
        lease.write("secret")
        AiAccess.revoke()
        assertFalse(lease.write("late"))
        AiAccess.grant("draft-token")
        assertFalse(lease.write("late after consent"))
        assertEquals("secret", store.bind("a", "t", ComposerDrafts.Destination.NewChat, AiAccess.bind("draft-token"))!!.text)
        AiAccess.revoke()
    }
    @Test fun structuredIdsCannotCollideAndSameIdentityRetainsText() {
        val store = ComposerDrafts()
        val first = store.bind("a", "b:c", ComposerDrafts.Destination.Chat("d"))!!
        val second = store.bind("a", "b", ComposerDrafts.Destination.Chat("c:d"))!!
        first.write("one"); second.write("two"); store.onIdentity("a")
        assertEquals("one", first.text); assertEquals("two", second.text)
    }
    @Test fun acceptedTransferClearsOnlyMatchingDraft() {
        val store = ComposerDrafts()
        val first = store.bind("a", "t", ComposerDrafts.Destination.NewChat)!!
        val second = store.bind("a", "t", ComposerDrafts.Destination.Chat("two"))!!
        first.write(" A "); second.write("B")
        assertFalse(first.submitted(false, " A ")); assertEquals(" A ", first.text)
        assertTrue(first.submitted(true, " A ")); assertEquals("", first.text)
        assertEquals("B", second.text)
        first.write("new"); first.submitted(true, "old"); assertEquals("new", first.text)
    }
}
