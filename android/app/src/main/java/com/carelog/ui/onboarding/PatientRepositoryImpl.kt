package com.carelog.ui.onboarding

import com.carelog.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Implementation of PatientRepository.
 */
@Singleton
class PatientRepositoryImpl @Inject constructor() : PatientRepository {

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val apiBaseUrl = BuildConfig.API_BASE_URL

    override suspend fun createPatient(
        token: String,
        request: CreatePatientRequest
    ): CreatePatientResult = withContext(Dispatchers.IO) {
        val requestBody = JSONObject().apply {
            put("name", request.name)
            request.patientEmail?.let { put("patientEmail", it) }
            request.dateOfBirth?.let { put("dateOfBirth", it) }
            request.gender?.let { put("gender", it) }
            request.bloodType?.let { put("bloodType", it) }
            put("medicalConditions", JSONArray(request.medicalConditions))
            put("allergies", JSONArray(request.allergies))
            put("medications", JSONArray(request.medications))
            request.emergencyContactName?.let { put("emergencyContactName", it) }
            request.emergencyContactPhone?.let { put("emergencyContactPhone", it) }
        }.toString()

        val httpRequest = Request.Builder()
            .url("$apiBaseUrl/patients")
            .header("Authorization", "Bearer $token")
            .header("Content-Type", "application/json")
            .post(requestBody.toRequestBody("application/json".toMediaType()))
            .build()

        val response = httpClient.newCall(httpRequest).execute()

        if (response.isSuccessful) {
            val responseBody = response.body.string()
            val json = JSONObject(responseBody)
            val patientId = json.optString("patientId").takeIf { it.isNotEmpty() }
                ?: throw Exception("Server did not return a patientId")
            CreatePatientResult(
                patientId = patientId,
                email = json.optString("email").takeIf { it.isNotEmpty() },
                temporaryPassword = json.optString("temporary_password").takeIf { it.isNotEmpty() },
                cognitoSub = json.optString("cognito_sub").takeIf { it.isNotEmpty() },
            )
        } else {
            val errorBody = response.body.string()
            throw Exception("Failed to create patient: HTTP ${response.code} $errorBody")
        }
    }
}
