package ai.nuphos.android

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.CredentialCatalog
import ai.nuphos.android.model.CredentialDraft
import ai.nuphos.android.model.CredentialSelection
import org.junit.Assert.*
import org.junit.Test

class CredentialDraftTest {
    private fun catalog(text: String) = CredentialCatalog(JsonValue.parse(text)!!, CredentialCatalog.NEW_CONVERSATION_PROVIDERS)
    private val mixed = catalog("""{
        "awsRoles":[{"roleId":"cloud"}],
        "devices":[{"deviceId":"online","available":true},{"deviceId":"legacy"},{"deviceId":"offline","available":false}],
        "resendIntegrations":[{"integrationId":"mail"}],
        "githubInstallations":[{"installationId":"github","accountLogin":"fixture"}],
        "posthogIntegrations":[{"integrationId":"analytics"}]
    }""")
    private fun loaded(catalog: CredentialCatalog = mixed): CredentialDraft {
        val pending = CredentialDraft().begin()
        return pending.finish(pending.request, Result.success(catalog))
    }
    private fun CredentialDraft.refresh(catalog: CredentialCatalog): CredentialDraft {
        val pending = begin()
        return pending.finish(pending.request, Result.success(catalog))
    }

    @Test fun firstSuccessSelectsAllUsableExceptResendAndIsReady() {
        assertFalse(CredentialDraft().isReady)
        val draft = loaded()
        assertTrue(draft.isReady)
        assertEquals(setOf("online", "legacy"), draft.selection.ids["deviceIds"])
        assertEquals(setOf("cloud"), draft.selection.ids["awsRoleIds"])
        assertEquals(setOf("github"), draft.selection.ids["githubInstallationIds"])
        assertEquals(setOf("analytics"), draft.selection.ids["posthogIntegrationIds"])
        assertTrue(draft.selection.ids["resendIntegrationIds"]!!.isEmpty())
    }

    @Test fun everyIosProviderIsSelectedAndSerializedUsingItsOwnIdentifierKey() {
        val providers = CredentialCatalog.NEW_CONVERSATION_PROVIDERS
        val all = CredentialCatalog(JsonValue.Obj(providers.associate {
            it.optionsKey to JsonValue.arr(JsonValue.obj(it.idKey to JsonValue.Str("id-${it.optionsKey}")))
        }), providers)
        val selection = loaded(all).selection
        assertEquals(32, providers.size)
        providers.forEach {
            // Resend stays opt-in, and the member's own GitHub / Linear is never picked for them.
            val expected = when (it.optionsKey) {
                "resendIntegrations", "trelloIntegrations" -> emptySet<String>()
                "personalCredentials" -> null
                else -> setOf("id-${it.optionsKey}")
            }
            assertEquals(expected, selection.ids[it.selectionKey])
            assertEquals(selection.ids[it.selectionKey].orEmpty().sorted(), selection.json[it.selectionKey]!!.arrayValue!!.map { value -> value.stringValue })
        }
    }

    @Test fun refreshPrunesRemovedCredentialsButNeverAddsNewOrDeselectedOnes() {
        val initial = loaded()
        val cloud = mixed.allItems.first { it.id == "cloud" }
        val edited = initial.copy(selection = initial.selection.toggle(cloud))
        val fresh = catalog("""{"awsRoles":[{"roleId":"cloud"},{"roleId":"added"}],"devices":[{"deviceId":"online"}]}""")
        val refreshed = edited.refresh(fresh)
        assertTrue(refreshed.selection.ids["awsRoleIds"]!!.isEmpty())
        assertEquals(setOf("online"), refreshed.selection.ids["deviceIds"])
        assertTrue(refreshed.selection.ids["githubInstallationIds"]!!.isEmpty())
    }

    @Test fun manualDeselectionDuringAnInFlightRefreshIsNotOverwritten() {
        val pending = loaded().begin()
        val edited = pending.copy(selection = CredentialSelection(newConversation = true))
        assertTrue(edited.finish(pending.request, Result.success(mixed)).selection.isEmpty)
    }

    @Test fun selectedDeviceGoingOfflineStaysSelectedForExplicitRemoval() {
        val refreshed = loaded().refresh(catalog("""{"devices":[{"deviceId":"online","available":false},{"deviceId":"offline","available":true}]}"""))
        assertEquals(setOf("online"), refreshed.selection.ids["deviceIds"])
        assertTrue(refreshed.catalog!!.allItems.first { it.id == "online" }.unavailable)
    }

    @Test fun resendOptInSurvivesRefreshButNotAnotherTeamOrLaunch() {
        val initial = loaded()
        val mail = mixed.allItems.first { it.id == "mail" }
        val edited = initial.copy(selection = initial.selection.toggle(mail))
        assertEquals(setOf("mail"), edited.refresh(mixed).selection.ids["resendIntegrationIds"])
        assertTrue(edited.reset().refresh(mixed).selection.ids["resendIntegrationIds"]!!.isEmpty())
        assertTrue(loaded().selection.ids["resendIntegrationIds"]!!.isEmpty())
    }

    @Test fun clearAllDoesNotReapplyDefaultsOnRefresh() {
        assertTrue(loaded().copy(selection = CredentialSelection()).refresh(mixed).selection.isEmpty)
    }

    @Test fun deselectedAndAbsentNewProvidersStayExplicitlyEmptyOnTheWire() {
        val draft = loaded().copy(selection = CredentialSelection(newConversation = true))
        val wire = draft.refresh(mixed).selection.json
        assertEquals(CredentialCatalog.NEW_CONVERSATION_PROVIDERS.map { it.selectionKey }.toSet(), wire.objectValue!!.keys)
        assertTrue(wire.objectValue!!.values.all { it.arrayValue!!.isEmpty() })
    }

    @Test fun successfulEmptyCatalogIsReadyAndLaterRefreshOnlyPrunes() {
        val empty = loaded(CredentialCatalog(emptyList()))
        assertTrue(empty.isReady)
        assertTrue(empty.refresh(mixed).selection.isEmpty)
    }

    @Test fun firstFailureAllowsSendAndRetrySuccessStillAppliesDefaults() {
        val pending = CredentialDraft().begin()
        val failed = pending.finish(pending.request, Result.failure(IllegalStateException("synthetic failure")))
        assertTrue(failed.isReady)
        assertEquals("synthetic failure", failed.error)
        assertNull(failed.catalog)
        val retried = failed.refresh(mixed)
        assertNull(retried.error)
        assertEquals(loaded().selection, retried.selection)
    }

    @Test fun failedRefreshPreservesLastSuccessfulCatalogAndManualSelection() {
        val selected = loaded().copy(selection = CredentialSelection())
        val pending = selected.begin()
        val failed = pending.finish(pending.request, Result.failure(IllegalStateException()))
        assertEquals(selected.catalog, failed.catalog)
        assertEquals(selected.selection, failed.selection)
        assertTrue(failed.isReady)
        assertNotNull(failed.error)
    }

    @Test fun reboundConnectorReplacesTheStaleIdWithoutAutoSelectingIt() {
        val before = catalog("""{"githubInstallations":[{"installationId":"install-a","accountLogin":"fixture"}],"devices":[{"deviceId":"online"}]}""")
        val after = catalog("""{"githubInstallations":[{"installationId":"install-b","accountLogin":"fixture"}],"devices":[{"deviceId":"online"}]}""")
        val initial = loaded(before)
        assertEquals(setOf("install-a"), initial.selection.ids["githubInstallationIds"])
        val pending = initial.begin()
        // The cached list and selection stay visible while the refresh is in flight.
        assertSame(initial.catalog, pending.catalog)
        assertEquals(initial.selection, pending.selection)
        val refreshed = pending.finish(pending.request, Result.success(after))
        assertEquals(listOf("install-b"), refreshed.catalog!!.allItems.filter { it.provider.optionsKey == "githubInstallations" }.map { it.id })
        assertTrue(refreshed.selection.ids["githubInstallationIds"]!!.isEmpty())
        assertEquals(setOf("online"), refreshed.selection.ids["deviceIds"])
        val replacement = after.allItems.first { it.id == "install-b" }
        assertEquals(setOf("install-b"), refreshed.selection.toggle(replacement).ids["githubInstallationIds"])
    }

    @Test fun failedForcedRefreshKeepsCachedListAndReopeningRecovers() {
        val after = catalog("""{"githubInstallations":[{"installationId":"install-b","accountLogin":"fixture"}]}""")
        val initial = loaded(catalog("""{"githubInstallations":[{"installationId":"install-a","accountLogin":"fixture"}]}"""))
        val pending = initial.begin()
        val failed = pending.finish(pending.request, Result.failure(IllegalStateException("unavailable")))
        assertSame(initial.catalog, failed.catalog)
        assertEquals(initial.selection, failed.selection)
        val reopened = failed.refresh(after)
        assertNull(reopened.error)
        assertEquals(setOf("install-b"), reopened.catalog!!.allItems.map { it.id }.toSet())
        assertTrue(reopened.selection.ids["githubInstallationIds"]!!.isEmpty())
    }

    @Test fun anEarlierResultShowsWhenANewerRequestNeverFinishes() {
        // #2580: the newer request is cancelled (the sheet closed, or its caller left the screen),
        // so the earlier one's result is the only one that will ever arrive.
        val first = CredentialDraft().begin()
        val second = first.begin()
        assertTrue(second.finish(first.request, Result.success(mixed)).isReady)
        assertTrue(second.finish(first.request, Result.failure(IllegalStateException("unavailable"))).isReady)
    }

    @Test fun anOlderResultNeverReplacesANewerOne() {
        val first = CredentialDraft().begin()
        val second = first.begin()
        val fresh = second.finish(second.request, Result.success(mixed))
        assertTrue(fresh.isReady)
        assertSame(fresh, fresh.finish(first.request, Result.success(catalog("""{"devices":[]}"""))))
        assertSame(fresh, fresh.finish(first.request, Result.failure(IllegalStateException("stale"))))
    }

    @Test fun resetOrphansRequestsAcrossTeamSwitchIncludingAwayAndBack() {
        val pending = loaded().begin()
        val reset = pending.reset().reset()
        assertFalse(reset.isReady)
        assertTrue(reset.selection.isEmpty)
        assertNull(reset.catalog)
        assertNull(reset.error)
        assertSame(reset, reset.finish(pending.request, Result.success(mixed)))
        assertSame(reset, reset.finish(pending.request, Result.failure(IllegalStateException("stale"))))
        assertEquals(loaded().selection, reset.refresh(mixed).selection)
    }

    @Test fun existingConversationWireKeysAndSelectionAreUnchangedByNewDraftLoads() {
        val existing = CredentialSelection(JsonValue.parse("""{"awsRoleIds":["stored"],"deviceIds":["offline"],"resendIntegrationIds":["mail"]}""")!!)
        val before = existing.json
        loaded().refresh(mixed).reset()
        assertEquals(before, existing.json)
        // Only the kinds it had: an unset GitHub stays unset, meaning every installation.
        assertEquals(setOf("awsRoleIds", "deviceIds", "resendIntegrationIds"), before.objectValue!!.keys)
        assertNull(before["githubInstallationIds"])
        assertEquals(setOf("mail"), existing.ids["resendIntegrationIds"])
    }

    @Test fun anExistingConversationKeepsAndChangesTheNewerKinds() {
        val existing = CredentialSelection(JsonValue.parse("""{"awsRoleIds":["stored"],"githubInstallationIds":["github"]}""")!!)
        // Read, not dropped: its GitHub installation shows ticked in the picker.
        assertEquals(setOf("github"), existing.ids["githubInstallationIds"])
        val github = mixed.allItems.single { it.id == "github" }
        val cleared = existing.toggle(github)
        assertEquals(emptyList<JsonValue>(), cleared.json["githubInstallationIds"]?.arrayValue)
        assertEquals(setOf("awsRoleIds", "githubInstallationIds"), cleared.json.objectValue!!.keys)
        // One that never set PostHog gains it as an explicit list, and nothing else unset is sent.
        val posthog = CredentialSelection(JsonValue.Obj(emptyMap())).toggle(mixed.allItems.single { it.id == "analytics" })
        assertEquals(setOf("posthogIntegrationIds"), posthog.json.objectValue!!.keys)
    }
}
