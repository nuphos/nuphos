package ai.nuphos.android

import ai.nuphos.android.data.JsonValue
import org.junit.Assert.*
import org.junit.Test

class JsonValueTypeTest {
    @Test fun quotedProviderIdentifiersAndBooleanWordsStayStrings() {
        val value = JsonValue.parse("""{"id":"000000000000000000000001","resourceId":"12345","label":"true","count":12345,"enabled":true}""")!!
        assertEquals("000000000000000000000001", value["id"]?.stringValue)
        assertEquals("12345", value["resourceId"]?.stringValue)
        assertEquals("true", value["label"]?.stringValue)
        assertEquals(12345.0, value["count"]?.numberValue)
        assertEquals(true, value["enabled"]?.boolValue)
    }
}
