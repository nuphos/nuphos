package ai.nuphos.android

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.CredentialCatalog
import ai.nuphos.android.model.CredentialSelection
import ai.nuphos.android.ui.chat.DeviceMention
import org.junit.Assert.*
import org.junit.Test

class DeviceMentionTest {
    private val catalog = CredentialCatalog(JsonValue.parse("""{
        "devices":[{"deviceId":"one","label":"Office Mac","available":true},
                   {"deviceId":"two","label":"Office Mac","available":true},
                   {"deviceId":"off","label":"Office Offline","available":false},
                   {"deviceId":"three","label":"Office PC","available":true},
                   {"deviceId":"four","label":"Office Linux","available":true}],
        "awsRoles":[{"roleId":"cloud","accountAlias":"Office AWS"}]
    }""")!!)
    private val selected = CredentialSelection(mapOf("deviceIds" to setOf("one", "off"), "awsRoleIds" to setOf("cloud")))

    @Test fun matchingIsCaseInsensitiveBoundedAndDeviceOnly() {
        assertEquals(listOf("one", "two", "three"), DeviceMention.results(catalog.allItems, "OFFICE", CredentialSelection()).map { it.id })
        assertEquals(listOf("off"), DeviceMention.results(catalog.allItems, "offline", selected).map { it.id })
        assertTrue(DeviceMention.results(catalog.allItems, "offline", CredentialSelection()).isEmpty())
    }
    @Test fun clickingIsAdditiveAndIdempotentEvenWithDuplicateLabels() {
        val second = catalog.allItems.first { it.id == "two" }
        val result = DeviceMention.select(selected, second)!!
        assertEquals(setOf("one", "two", "off"), result.ids["deviceIds"])
        assertEquals(setOf("cloud"), result.ids["awsRoleIds"])
        assertEquals(result, DeviceMention.select(result, second))
    }
    @Test fun unavailableOrNonDeviceCannotGrantAccess() {
        assertNull(DeviceMention.select(selected, catalog.allItems.first { it.id == "off" }))
        assertNull(DeviceMention.select(selected, catalog.allItems.last()))
        assertEquals(setOf("one", "off"), selected.ids["deviceIds"])
    }
    @Test fun duplicateNamesHaveUniqueVisibleIdentifiersIncludingSuffixCollisions() {
        val sameName = catalog.allItems.first()
        val other = catalog.allItems[1]
        assertEquals("one", DeviceMention.identity(sameName, catalog.allItems))
        assertEquals("two", DeviceMention.identity(other, catalog.allItems))
        assertNull(DeviceMention.identity(catalog.allItems.first { it.id == "three" }, catalog.allItems))
        val a = sameName.copy(id = "device-1abcd")
        val b = other.copy(id = "device-2abcd", label = sameName.label.uppercase())
        assertEquals("…1abcd", DeviceMention.identity(a, listOf(a, b)))
        assertEquals("…2abcd", DeviceMention.identity(b, listOf(a, b)))
    }

}
