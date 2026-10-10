package ai.nuphos.android.connectors

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.*
import ai.nuphos.android.session.*
import org.junit.Assert.*
import org.junit.Test

class ConnectorContractTest {
    @Test fun inventoryIncludesEveryArrayAndIsolatesMalformedRows() {
        val json = JsonValue.Obj(ConnectorCatalog.arrayKeys.associateWith {
            JsonValue.arr(JsonValue.obj("id" to JsonValue.Str("saved")), JsonValue.Null, JsonValue.obj("label" to JsonValue.Str("bad")))
        })
        val rows = ConnectorInventory.decode(json).rows
        assertEquals(29, rows.size)
        assertEquals(ConnectorCatalog.arrayKeys.toSet(), rows.map { it.provider }.toSet())
    }
    @Test fun idsPreferBindingAndZeaburIdentitiesStayDistinct() {
        val inventory = ConnectorInventory.decode(JsonValue.parse("""{"github":[{"id":"binding","accountId":123}],"zeabur":[{"providerId":"p","zeaburId":"a","kind":"user"},{"providerId":"p","zeaburId":"b","kind":"team"}]}""")!!)
        assertEquals("binding", inventory.rows.first { it.provider == "github" }.bindingId)
        assertEquals(3, inventory.rows.map { it.key }.distinct().size)
    }
    @Test fun objectSlotsIncludeLinkedSlackButNotConfigurationAlone() {
        val rows = ConnectorInventory.decode(JsonValue.parse("""{"slack":{"installation":null,"linkedChannels":{"count":1,"grantWorkspaces":[{"id":"w","name":"Workspace"}]}},"lark":{"installation":{"id":"l","tenantName":"Team"}},"discord":{"configured":true,"installation":null,"channels":[]}}""")!!).rows
        assertEquals(setOf("slack", "lark"), rows.map { it.provider }.toSet())
    }
    @Test fun formsHaveExactlyFifteenSupportedProviders() {
        assertEquals(15, ConnectorCatalog.all.count { it.fields.isNotEmpty() })
        assertEquals(4, ConnectorCatalog.all.count { it.oauth })
        assertEquals(7, ConnectorCatalog.all.count { it.key in setOf("gcp","cloudflare","tencent","aliyun","volcengine","onprem","gitlab") && !it.canAdd })
    }
    @Test fun optionalTokensAndRawPasswordFollowServerContract() {
        val better = ConnectorCatalog.named("betterstack")!!
        assertFalse(better.validate(mapOf("label" to "test")).valid)
        val valid = better.validate(mapOf("label" to " test ", "uptimeApiToken" to " key ", "telemetryApiToken" to " "))
        assertTrue(valid.valid)
        assertEquals(mapOf("label" to "test", "uptimeApiToken" to "key"), valid.body)
        val kuma = ConnectorCatalog.named("uptimeKuma")!!
        assertFalse(kuma.validate(mapOf("label" to "test", "baseUrl" to "https://status.example", "username" to "user")).valid)
        val result = kuma.validate(mapOf("label" to "test", "baseUrl" to "http://status.example", "username" to " user ", "password" to " pass "))
        assertTrue(result.valid)
        assertEquals(" pass ", result.body["password"])
    }
    @Test fun validationRejectsWrongArnGuidEmailUrlAndLengths() {
        assertFalse(ConnectorCatalog.named("aws")!!.validate(mapOf("roleArn" to "arn:aws:iam::1:role/x")).valid)
        assertFalse(ConnectorCatalog.named("azure")!!.validate(mapOf("label" to "a", "tenantId" to "bad", "clientId" to "bad", "subscriptionId" to "bad")).valid)
        assertFalse(ConnectorCatalog.named("upstash")!!.validate(mapOf("label" to "a", "email" to "bad", "apiKey" to "x")).valid)
        assertFalse(ConnectorCatalog.named("grafana")!!.validate(mapOf("name" to "a", "grafanaUrl" to "ftp://host", "saToken" to "x")).valid)
        assertFalse(ConnectorCatalog.named("notion")!!.validate(mapOf("label" to "a", "token" to "x".repeat(301))).valid)
    }
    @Test fun callbackRequiresExactStateTeamHostExpiryAndSingleQueries() {
        val pending = ConnectorPending("team", "linear", "abc", 1000)
        assertTrue(ConnectorCallback.validate("nuphos://linear-callback?state=abc&team_id=team&binding_id=b", pending, 999) is ConnectorReturn.OAuth)
        listOf("https://linear-callback?state=abc", "nuphos://jira-callback?state=abc", "nuphos://linear-callback?state=abc&state=abc&team_id=team&binding_id=b", "nuphos://linear-callback?state=abc&team_id=other&binding_id=b", "nuphos://linear-callback?state=abc&team_id=team", "nuphos://linear-callback?state=abc&error=denied").forEach {
            assertTrue(it, ConnectorCallback.validate(it, pending, 999) is ConnectorReturn.Invalid)
        }
        assertTrue(ConnectorCallback.validate("nuphos://linear-callback?state=abc&team_id=team&binding_id=b", pending, 1000) is ConnectorReturn.Invalid)
    }
    @Test fun githubRejectsUnicodeNonpositiveAndUnexpectedActions() {
        val pending = ConnectorPending("team", "github", "abc", 1000)
        assertEquals(42L, (ConnectorCallback.validate("nuphos://github-callback?state=abc&installation_id=42&setup_action=update", pending, 0) as ConnectorReturn.Github).installationId)
        listOf("0", "-1", "４２", "9007199254740992").forEach { id ->
            assertTrue(ConnectorCallback.validate("nuphos://github-callback?state=abc&installation_id=$id", pending, 0) is ConnectorReturn.Invalid)
        }
        assertTrue(ConnectorCallback.validate("nuphos://github-callback?state=abc&installation_id=42&setup_action=delete", pending, 0) is ConnectorReturn.Invalid)
    }
}
