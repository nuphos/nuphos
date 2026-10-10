package ai.nuphos.android

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.CredentialCatalog
import ai.nuphos.android.model.CredentialSelection
import org.junit.Assert.*
import org.junit.Test

class ComputerCredentialTest {
    private val catalog = CredentialCatalog(JsonValue.parse("""{
        "devices":[{"deviceId":"mac","label":"Work computer","platform":"darwin"},
                   {"deviceId":"pc","label":"Work computer","platform":"win32"}],
        "awsRoles":[{"roleId":"aws","accountAlias":"Cloud"}]
    }""")!!)

    @Test fun ownComputersHaveDistinctIdsAndReadablePlatforms() {
        val computers = catalog.sections.first { it.provider.optionsKey == "devices" }
        assertEquals("My computers", computers.provider.title)
        assertEquals(listOf("mac", "pc"), computers.items.map { it.id })
        assertEquals(listOf("macOS", "Windows"), computers.items.map { it.detail })
        assertEquals(listOf("Work computer", "Work computer"), computers.items.map { it.label })
    }

    @Test fun computerMultiSelectionRoundTripsWithoutChangingCloudAccess() {
        val computers = catalog.allItems.filter { it.provider.optionsKey == "devices" }
        val stored = CredentialSelection(JsonValue.parse("""{"deviceIds":["mac"],"awsRoleIds":["aws"]}""")!!)
        assertTrue(stored.contains(computers[0]))
        val both = stored.toggle(computers[1])
        assertEquals(listOf("mac", "pc"), both.json["deviceIds"]!!.arrayValue!!.map { it.stringValue })
        assertEquals(setOf("aws"), both.ids["awsRoleIds"])
        assertEquals(both, CredentialSelection(both.json))
        val none = both.toggle(computers[0]).toggle(computers[1])
        assertTrue(none.json["deviceIds"]!!.arrayValue!!.isEmpty())
        assertEquals(setOf("aws"), none.ids["awsRoleIds"])
    }

    @Test fun unavailableComputerIsPrunedWithoutDroppingOtherPermissions() {
        val stored = CredentialSelection(JsonValue.parse("""{"deviceIds":["mac","gone"],"awsRoleIds":["aws"]}""")!!)
        val available = stored.pruned(catalog)
        assertEquals(setOf("mac"), available.ids["deviceIds"])
        assertEquals(setOf("aws"), available.ids["awsRoleIds"])
        assertEquals(2, available.count)
    }
}
