package com.carelog.ui.invite

import com.carelog.core.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Implementation of InviteRepository.
 */
@Singleton
class InviteRepositoryImpl @Inject constructor() : InviteRepository {

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val apiBaseUrl = BuildConfig.API_BASE_URL

    override suspend fun sendAttendantInvite(
        token: String,
        request: SendInviteRequest
    ): SendInviteResponse = withContext(Dispatchers.IO) {
        val requestBody = JSONObject().apply {
            put("patientId", request.patientId)
            put("attendantName", request.attendantName)
            request.email?.let { put("email", it) }
            request.phone?.let { put("phone", it) }
        }.toString()

        val httpRequest = Request.Builder()
            .url("$apiBaseUrl/invites/attendant")
            .header("Authorization", "Bearer $token")
            .header("Content-Type", "application/json")
            .post(requestBody.toRequestBody("application/json".toMediaType()))
            .build()

        val response = httpClient.newCall(httpRequest).execute()
        val responseBody = response.body?.string() ?: "{}"

        if (response.isSuccessful) {
            val json = JSONObject(responseBody)
            SendInviteResponse(
                inviteId = json.optString("inviteId", ""),
                message = json.optString("message", "Invitation sent successfully"),
                expiresAt = json.optString("expiresAt", "")
            )
        } else {
            throw Exception("Failed to send invitation: HTTP ${response.code} $responseBody")
        }
    }

    override suspend fun sendDoctorInvite(
        token: String,
        request: SendDoctorInviteRequest
    ): SendInviteResponse = withContext(Dispatchers.IO) {
        val requestBody = JSONObject().apply {
            put("patientId", request.patientId)
            put("doctorName", request.doctorName)
            put("doctorEmail", request.doctorEmail)
            request.specialty?.let { put("specialty", it) }
        }.toString()

        val httpRequest = Request.Builder()
            .url("$apiBaseUrl/invites/doctor")
            .header("Authorization", "Bearer $token")
            .header("Content-Type", "application/json")
            .post(requestBody.toRequestBody("application/json".toMediaType()))
            .build()

        val response = httpClient.newCall(httpRequest).execute()
        val responseBody = response.body?.string() ?: "{}"

        if (response.isSuccessful) {
            val json = JSONObject(responseBody)
            SendInviteResponse(
                inviteId = json.optString("inviteId", ""),
                message = json.optString("message", "Invitation sent successfully"),
                expiresAt = json.optString("expiresAt", "")
            )
        } else {
            throw Exception("Failed to send invitation: HTTP ${response.code} $responseBody")
        }
    }
}
