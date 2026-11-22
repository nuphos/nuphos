package ai.nuphos.android.desktop

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Test

// #2947: a desktop the backend refuses says why, instead of blaming the account.
class DesktopRefusalTest {
    private fun refused(code: Int, body: String)=Response.Builder()
        .request(Request.Builder().url("https://api.nuphos.test/teams/t/runtime-desktop/s").build())
        .protocol(Protocol.HTTP_1_1).code(code).message("refused")
        .body(body.toResponseBody("application/json".toMediaType())).build()

    @Test fun aMacWithoutAccessibilitySaysWhereToAllowIt() {
        val reason="Accessibility is not allowed for Nuphos yet. Allow it on this Mac in System Settings > Privacy & Security > Accessibility."
        assertEquals(reason,desktopRefusal(refused(409,"""{"error":{"code":"agent_instance_failed","message":"$reason"}}""")))
    }

    @Test fun anAnswerWithoutAReasonKeepsTheGeneralOne() {
        assertEquals("Desktop is not available to this account.",desktopRefusal(refused(502,"<html>bad gateway</html>")))
    }
}
