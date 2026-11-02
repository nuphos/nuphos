package ai.nuphos.android.session
import ai.nuphos.android.data.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class RuntimeInventoryParityTest {
    private val cloud = AgentRuntime("cloud", "codex", "Cloud", "active", "managed")
    private val local = cloud.copy(id="local", kind="local", local=RuntimeHost("host", "Computer", true))
    private val host = RuntimeDevice("host", "Box", true, true, "unavailable", null, null, null, "manage")
    @Test fun destinationsRespectExplicitBoxAccessAndWorkspaceRole() {
        assertEquals(InventoryDestination.CloudDetails, inventoryDestination(cloud,true,emptyList()))
        assertEquals(InventoryDestination.AdministratorInstructions, inventoryDestination(cloud,false,emptyList()))
        assertEquals(InventoryDestination.ProviderSignIn, inventoryDestination(local,false,listOf(host)))
        for (h in listOf(host.copy(access="use"),host.copy(access=null),host.copy(box=false),host.copy(online=false)))
            assertEquals(InventoryDestination.HostInstructions,inventoryDestination(local,true,listOf(h)))
        assertEquals(InventoryDestination.CloudDetails,inventoryDestination(cloud.copy(deleting=true),true,emptyList()))
    }
    private class Fake(var rows: List<AgentRuntime>) : RuntimeTransport {
        var starts=0; var codes=0; var creates=0
        var held: CompletableDeferred<Unit>?=null
        var attempt=RuntimeLogin("00000000-0000-4000-8000-000000000001","awaiting_authorization",100000,
            step=RuntimeLoginStep("choose",options=listOf(RuntimeLoginOption("a","Option A"))))
        override suspend fun catalog()=rows
        override suspend fun create(provider:String,label:String?):AgentRuntime { creates++; return rows.last() }
        override suspend fun start(runtimeId:String):RuntimeLogin { starts++; held?.await(); return attempt }
        override suspend fun login(runtimeId:String)=attempt
        override suspend fun code(runtimeId:String,attemptId:String,code:String):RuntimeLogin { codes++; return attempt.copy(codeSubmitted=true) }
        override suspend fun cancel(runtimeId:String,attemptId:String) {}
    }
    @Test fun boxLoginCannotCreateOrChangeSelectionAndLateRevocationHidesAttempt()=runTest {
        val api=Fake(listOf(cloud,local)); val selection=RuntimeSelections().bind("a","t")
        selection.saveCatalog(api.rows);selection.select(cloud.id)
        var allowed=true
        val store=RuntimeSetupStore(api,this,{true},{false},selection,{},now={0},loginAllowed={allowed && it.id==local.id})
        store.open();runCurrent();assertTrue(store.focusSignIn(local.id))
        store.create("codex",null);runCurrent();assertEquals(0,api.creates)
        api.held=CompletableDeferred();store.startLogin();runCurrent();allowed=false
        api.held!!.complete(Unit);runCurrent()
        assertNull(store.state.attempt);assertFalse(store.canSignIn);assertEquals(cloud.id,selection.selectedId)
        store.submitCode("a");runCurrent();assertEquals(0,api.codes);store.close()
    }
    @Test fun inventoryCreationKeepsCurrentSelection()=runTest {
        val added=cloud.copy(id="added",provider="opencode");val api=Fake(listOf(cloud,added))
        val selection=RuntimeSelections().bind("a","t");selection.saveCatalog(listOf(cloud));selection.select(cloud.id)
        val store=RuntimeSetupStore(api,this,{true},{true},selection,{},now={0},selectCreatedRuntime=false)
        store.create("opencode",null);runCurrent()
        assertEquals(1,api.creates);assertEquals(cloud.id,selection.selectedId);assertEquals(added.id,store.signInRuntime?.id);store.close()
    }
    @Test fun deniedRefreshRemovesCachedCatalogWithoutSigningOut()=runTest {
        var denied=false;var expired=0;var usageReads=0
        val store=RuntimesStore(this,{true},{if(denied)throw RuntimeHttpFailure(403,null) else listOf(cloud)},
            {usageReads++;emptyMap()},{emptyList()},{expired++})
        store.refresh();runCurrent();assertEquals(1,store.runtimes.size)
        denied=true;store.refresh();runCurrent()
        assertTrue(store.runtimes.isEmpty());assertFalse(store.loaded);assertFalse(store.loading)
        assertEquals(0,expired);assertEquals(1,usageReads);store.close()
    }
    @Test fun answersAreBoundToTheCurrentStep() {
        val attempt=Fake(emptyList()).attempt
        assertTrue(validRuntimeAnswer(attempt,"a"));assertFalse(validRuntimeAnswer(attempt,"b"))
        assertTrue(validRuntimeAnswer(attempt.copy(step=RuntimeLoginStep("input",secret=true)),"synthetic value"))
        assertFalse(validRuntimeAnswer(attempt.copy(step=RuntimeLoginStep("input")),"line1\nline2"))
        assertFalse(validRuntimeAnswer(attempt.copy(step=RuntimeLoginStep("browser")),"reply"))
        assertTrue(validRuntimeAnswer(attempt.copy(step=RuntimeLoginStep("browser",paste="address")),"http://localhost/callback?code=fixture"))
        assertFalse(validRuntimeAnswer(attempt.copy(step=null,authorizationUrl="https://example.invalid"),"unbound"))
    }
}
