package com.carelog.ui.consent

import com.carelog.auth.AuthRepository
import com.carelog.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Implementation of ConsentRepository.
 */
@Singleton
class ConsentRepositoryImpl @Inject constructor(
    private val authRepository: AuthRepository
) : ConsentRepository {

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val apiBaseUrl = BuildConfig.API_BASE_URL

    // GET /consent returns BOTH the user's status AND the current
    // server-side text/version/hash in one payload (Stream C). Cache it
    // so getConsentText() and getConsentStatus() share a single call.
    private var cachedPayload: ConsentPayload? = null

    private suspend fun fetchConsent(): ConsentPayload = withContext(Dispatchers.IO) {
        cachedPayload?.let { return@withContext it }
        val token = authRepository.getAccessToken() ?: throw Exception("Not authenticated")

        val request = Request.Builder()
            .url("$apiBaseUrl/consent")
            .header("Authorization", "Bearer $token")
            .get()
            .build()

        val response = httpClient.newCall(request).execute()
        val responseBody = response.body.string()

        if (!response.isSuccessful) {
            throw Exception("API ${response.code}: $responseBody")
        }

        val json = JSONObject(responseBody)
        val payload = ConsentPayload(
            hasConsent = json.optBoolean("hasConsent", false),
            consentVersion = json.optString("consentVersion").takeIf { it.isNotEmpty() },
            acceptedAt = json.optString("acceptedAt").takeIf { it.isNotEmpty() },
            currentVersion = json.optString("currentVersion", "2.0"),
            needsUpdate = json.optBoolean("needsUpdate", false),
            consentText = json.optString("consentText"),
            consentHash = json.optString("consentHash"),
        )
        cachedPayload = payload
        payload
    }

    override suspend fun getConsentText(): ConsentData {
        val p = fetchConsent()
        return ConsentData(
            version = p.currentVersion,
            text = p.consentText,
            hash = p.consentHash,
            lastUpdated = ""
        )
    }

    override suspend fun getConsentStatus(): ConsentStatus {
        val p = fetchConsent()
        return ConsentStatus(
            hasConsent = p.hasConsent,
            consentVersion = p.consentVersion,
            acceptedAt = p.acceptedAt,
            currentVersion = p.currentVersion,
            needsUpdate = p.needsUpdate,
        )
    }

    override suspend fun recordConsent(version: String, textHash: String) {
        val token = authRepository.getAccessToken() ?: throw Exception("Not authenticated")

        val requestBody = JSONObject().apply {
            put("version", version)
            put("textHash", textHash)
            put("acceptedTerms", true)
        }.toString()

        val request = Request.Builder()
            .url("$apiBaseUrl/consent")
            .header("Authorization", "Bearer $token")
            .header("Content-Type", "application/json")
            .post(requestBody.toRequestBody("application/json".toMediaType()))
            .build()

        val response = withContext(Dispatchers.IO) {
            httpClient.newCall(request).execute()
        }

        if (!response.isSuccessful) {
            val body = response.body.string()
            throw Exception("Failed to record consent: API ${response.code}: $body")
        }
        // Invalidate cache so the next getConsentStatus() call sees the
        // user as having consented (otherwise SplashViewModel would still
        // route through CONSENT on the next launch).
        cachedPayload = null
    }

    private data class ConsentPayload(
        val hasConsent: Boolean,
        val consentVersion: String?,
        val acceptedAt: String?,
        val currentVersion: String,
        val needsUpdate: Boolean,
        val consentText: String,
        val consentHash: String,
    )

    override suspend fun withdrawConsent(reason: String?) {
        val token = authRepository.getAccessToken() ?: throw Exception("Not authenticated")

        val requestBody = JSONObject().apply {
            reason?.let { put("reason", it) }
            put("withdrawnAt", System.currentTimeMillis())
        }.toString()

        val request = Request.Builder()
            .url("$apiBaseUrl/consent")
            .header("Authorization", "Bearer $token")
            .header("Content-Type", "application/json")
            .delete(requestBody.toRequestBody("application/json".toMediaType()))
            .build()

        val response = withContext(Dispatchers.IO) {
            httpClient.newCall(request).execute()
        }

        if (!response.isSuccessful) {
            val body = response.body.string()
            throw Exception("Failed to withdraw consent: API ${response.code}: $body")
        }
    }
}
