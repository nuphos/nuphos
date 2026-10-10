package ai.nuphos.android.session

import ai.nuphos.android.data.*
import ai.nuphos.android.model.Team
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class WorkspaceSetupStoreTest {
    private val target = Team("507f1f77bcf86cd799439011", "Saved", role = "EDITOR", isOwner = false)
    private class Fixture(val team: Team) : WorkspaceTransport {
        var posts = 0; var reads = 0; var saved = listOf(team)
        var writeError: Exception? = null; var readError: Exception? = null
        var wait: CompletableDeferred<Unit>? = null
        override suspend fun memberships(): List<Team> { reads++; readError?.let { throw it }; return saved }
        override suspend fun discoverable() = emptyList<Team>()
        override suspend fun create(name: String): Team { posts++; wait?.await(); writeError?.let { throw it }; return team }
        override suspend fun join(teamId: String) = create("unused")
    }
    @Test fun doubleClickSelectsOnlyExactSavedMembership() = runTest {
        val fixture = Fixture(target); fixture.wait = CompletableDeferred()
        val selected = mutableListOf<Team>()
        val store = WorkspaceSetupStore(fixture, this, { true }, { _, team -> team?.let { selected += it }; true }, {})
        store.create("Saved"); store.create("Saved"); runCurrent()
        assertEquals(1, fixture.posts); assertTrue(selected.isEmpty())
        fixture.wait!!.complete(Unit); advanceUntilIdle()
        assertEquals(listOf(target), selected); assertEquals(1, fixture.reads)
    }
    @Test fun returnedIdAbsentNeverSelectsOrRetries() = runTest {
        val fixture = Fixture(target); fixture.saved = listOf(target.copy(id = "507f1f77bcf86cd799439012"))
        var selected = false
        val store = WorkspaceSetupStore(fixture, this, { true }, { _, team -> selected = team != null; true }, {})
        store.create("Saved"); advanceUntilIdle(); store.create("Saved"); advanceUntilIdle()
        assertFalse(selected); assertTrue(store.state.reviewRequired); assertEquals(1, fixture.posts)
    }
    @Test fun unknownCreateReadsButNeverAutoChoosesDuplicateName() = runTest {
        val fixture = Fixture(target); fixture.writeError = IOException("Lost receipt")
        var selected: Team? = null
        val store = WorkspaceSetupStore(fixture, this, { true }, { _, team -> selected = team; true }, {})
        store.create("Saved"); advanceUntilIdle(); store.create("Saved"); advanceUntilIdle()
        assertEquals(1, fixture.posts); assertEquals(1, fixture.reads); assertNull(selected)
        assertTrue(store.state.reviewRequired); assertEquals(listOf(target), store.state.memberships)
        store.reviewSaved(target.id); assertEquals(target, selected)
    }
    @Test fun failedReconcileKeepsPostsBlockedUntilExplicitReviewAfterRead() = runTest {
        val fixture = Fixture(target); fixture.writeError = IOException(); fixture.readError = IOException()
        val store = WorkspaceSetupStore(fixture, this, { true }, { _, _ -> true }, {})
        store.join(target.id); advanceUntilIdle(); store.reviewSaved(target.id); store.join(target.id); advanceUntilIdle()
        assertTrue(store.state.reviewRequired); assertFalse(store.state.reconciled); assertEquals(1, fixture.posts)
        fixture.readError = null; store.refresh(); advanceUntilIdle()
        assertTrue(store.state.reconciled); assertTrue(store.state.reviewRequired)
    }
    @Test fun alreadyMemberRefreshesThenSelectsOnlyRequestedId() = runTest {
        val fixture = Fixture(target); fixture.writeError = WorkspaceAlreadyMember()
        var selected: Team? = null
        val store = WorkspaceSetupStore(fixture, this, { true }, { _, team -> selected = team; true }, {})
        store.join(target.id); advanceUntilIdle()
        assertEquals(target, selected); assertEquals(1, fixture.posts)
    }
    @Test fun sourceGenerationAndDismissalRejectLateResults() = runTest {
        val fixture = Fixture(target); fixture.wait = CompletableDeferred()
        var generation = 1; val expected = generation; var applies = 0
        val store = WorkspaceSetupStore(fixture, this, { generation == expected }, { _, _ -> applies++; true }, {})
        store.create("Saved"); runCurrent(); generation = 2; generation = 3
        fixture.wait!!.complete(Unit); advanceUntilIdle(); assertEquals(0, applies)
        generation = expected
        fixture.wait = CompletableDeferred()
        val next = WorkspaceSetupStore(fixture, this, { true }, { _, _ -> applies++; true }, {})
        next.create("Saved"); runCurrent(); next.close(); fixture.wait!!.complete(Unit); advanceUntilIdle()
        assertEquals(0, applies); assertTrue(next.state.reviewRequired)
    }
    @Test fun unrelated409NeverSelectsOrReadsAsAlreadyMember() = runTest {
        val fixture = Fixture(target); fixture.writeError = NuphosApi.Failure.Http(409, "different_conflict")
        var selected: Team? = null
        val store = WorkspaceSetupStore(fixture, this, { true }, { _, team -> selected = team; true }, {})
        store.join(target.id); advanceUntilIdle()
        assertNull(selected); assertEquals(0, fixture.reads); assertFalse(store.state.reviewRequired)
    }
    @Test fun recreatedViewWithFailedReadCannotRetryPendingWrite() = runTest {
        val fixture = Fixture(target); fixture.wait = CompletableDeferred()
        val review = WorkspaceWriteReview()
        val first = WorkspaceSetupStore(fixture, this, { true }, { _, _ -> true }, {}, review)
        first.create("Saved"); runCurrent(); first.close()
        fixture.readError = IOException()
        val recreated = WorkspaceSetupStore(fixture, this, { true }, { _, _ -> true }, {}, review)
        recreated.open(); advanceUntilIdle(); recreated.create("Saved"); advanceUntilIdle()
        assertTrue(recreated.state.reviewRequired); assertFalse(recreated.state.reconciled); assertEquals(1, fixture.posts)
    }
    @Test fun failedNewReconcileCannotReuseEarlierReviewConfirmation() = runTest {
        val fixture = Fixture(target); fixture.writeError = IOException()
        val store = WorkspaceSetupStore(fixture, this, { true }, { _, _ -> true }, {})
        store.create("Saved"); advanceUntilIdle(); assertTrue(store.state.reconciled)
        fixture.readError = IOException(); store.refresh(); advanceUntilIdle(); store.confirmReviewed()
        assertTrue(store.state.reviewRequired); assertFalse(store.state.reconciled)
    }
    @Test fun changedSourceBeforeScheduledWorkSendsNoRequest() = runTest {
        val fixture = Fixture(target); var current = true
        val store = WorkspaceSetupStore(fixture, this, { current }, { _, _ -> true }, {})
        store.create("Saved"); current = false; advanceUntilIdle()
        assertEquals(0, fixture.posts); assertEquals(0, fixture.reads)
    }
    @Test fun forbiddenDoesNotExpireBut401Does() = runTest {
        val fixture = Fixture(target); var expired = 0
        val store = WorkspaceSetupStore(fixture, this, { true }, { _, _ -> true }, { expired++ })
        fixture.writeError = NuphosApi.Failure.Http(403, "domain_not_allowed")
        store.join(target.id); advanceUntilIdle(); assertEquals(0, expired); assertFalse(store.state.reviewRequired)
        fixture.writeError = NuphosApi.Failure.Unauthorized
        store.join(target.id); advanceUntilIdle(); assertEquals(1, expired)
    }
}
