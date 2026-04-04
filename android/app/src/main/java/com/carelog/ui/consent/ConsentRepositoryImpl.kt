package com.carelog.ui.consent

import com.carelog.auth.AuthRepository
import com.carelog.core.BuildConfig
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

    override suspend fun getConsentText(): ConsentData {
        // For now, return a placeholder consent text
        // In production, this would fetch from the API
        return ConsentData(
            version = "1.0",
            text = """
                CareLog Privacy Consent

                By using CareLog, you consent to the collection, storage, and processing of your health data
                in accordance with the Digital Personal Data Protection Act (DPDP) of India.

                Data Collection:
                • Vital signs (blood pressure, glucose, temperature, weight, pulse, SpO2)
                • Medical documents (prescriptions, reports)
                • Voice and video notes

                Data Use:
                • To provide health monitoring services
                • To share with your designated care team (family members, doctors, attendants)
                • To generate health insights and alerts

                Your Rights:
                • Right to access your data
                • Right to correct your data
                • Right to withdraw consent
                • Right to data portability

                Data Security:
                • All data is encrypted at rest and in transit
                • Data is stored in compliance with Indian data localization requirements
                • Access is controlled through role-based permissions

                By accepting this consent, you acknowledge that you have read, understood, and agree to
                the terms outlined above.
            """.trimIndent(),
            hash = "sha256:placeholder-hash",
            lastUpdated = "2024-01-01T00:00:00Z"
        )
    }

    override suspend fun getConsentStatus(): ConsentStatus = withContext(Dispatchers.IO) {
        val token = authRepository.getAccessToken() ?: throw Exception("Not authenticated")

        val request = Request.Builder()
            .url("$apiBaseUrl/consent")
            .header("Authorization", "Bearer $token")
            .get()
            .build()

        val response = httpClient.newCall(request).execute()
        val responseBody = response.body?.string() ?: ""

        if (!response.isSuccessful) {
            throw Exception("API ${response.code}: $responseBody")
        }

        val json = JSONObject(responseBody)
        ConsentStatus(
            hasConsent = json.optBoolean("hasConsent", false),
            consentVersion = json.optString("consentVersion", null),
            acceptedAt = json.optString("acceptedAt", null),
            currentVersion = json.optString("currentVersion", "1.0"),
            needsUpdate = json.optBoolean("needsUpdate", false)
        )
    }

    override suspend fun recordConsent(version: String, textHash: String) {
        val token = authRepository.getAccessToken() ?: throw Exception("Not authenticated")

        val requestBody = JSONObject().apply {
            put("version", version)
            put("textHash", textHash)
            put("acceptedAt", System.currentTimeMillis())
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
            val body = response.body?.string() ?: ""
            throw Exception("Failed to record consent: API ${response.code}: $body")
        }
    }

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
            val body = response.body?.string() ?: ""
            throw Exception("Failed to withdraw consent: API ${response.code}: $body")
        }
    }
}
