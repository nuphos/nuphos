package ai.nuphos.android.data

import android.app.Activity
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Passkeys as a second factor (#1054), through Credential Manager. The backend's
 * options are WebAuthn JSON, which Credential Manager takes as is, and its
 * answer is the JSON the backend verifies. The passkey belongs to the backend's
 * RP ID (nuphos.ai), which lets this app in through `get_login_creds` in
 * nuphos.ai/.well-known/assetlinks.json.
 */
object Passkeys {
    /** A passkey's answer to `options`, as `AuthenticationResponseJSON`. */
    suspend fun answer(activity: Activity, options: JsonObject): JsonElement {
        val request = GetCredentialRequest(listOf(GetPublicKeyCredentialOption(requestJson = options.toString())))
        val credential = CredentialManager.create(activity).getCredential(activity, request).credential
        val answer = (credential as? PublicKeyCredential)?.authenticationResponseJson
            ?: throw NuphosApi.Failure.InvalidResponse
        return Http.json.parseToJsonElement(answer)
    }

    /** A new passkey for `options`, as `RegistrationResponseJSON`. */
    suspend fun create(activity: Activity, options: JsonObject): JsonElement {
        val response = CredentialManager.create(activity)
            .createCredential(activity, CreatePublicKeyCredentialRequest(options.toString()))
        val created = (response as? CreatePublicKeyCredentialResponse)?.registrationResponseJson
            ?: throw NuphosApi.Failure.InvalidResponse
        return Http.json.parseToJsonElement(created)
    }
}
