package com.carelog.api

import com.carelog.auth.AuthRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * API service for relative-specific operations.
 * Fetches patient data, vitals summary, thresholds, reminders, and alerts.
 */
@Singleton
class RelativeApiService @Inject constructor(
    private val authRepository: AuthRepository
) {
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val apiBaseUrl = "https://api.carelog.app" // TODO: Get from config

    /**
     * Fetch patient summary including latest vitals.
     */
    suspend fun getPatientSummary(patientId: String): PatientSummary? = withContext(Dispatchers.IO) {
        try {
            val token = authRepository.getAccessToken() ?: return@withContext null

            val request = Request.Builder()
                .url("$apiBaseUrl/patients/$patientId/summary")
                .header("Authorization", "Bearer $token")
                .get()
                .build()

            val response = httpClient.newCall(request).execute()
            if (!response.isSuccessful) return@withContext null

            val json = JSONObject(response.body?.string() ?: return@withContext null)
            parsePatientSummary(json)
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Fetch vital observations for a patient within a date range.
     */
    suspend fun getObservations(
        patientId: String,
        vitalType: VitalType? = null,
        startDate: Instant? = null,
        endDate: Instant? = null
    ): List<VitalObservation> = withContext(Dispatchers.IO) {
        try {
            val token = authRepository.getAccessToken() ?: return@withContext emptyList()

            val urlBuilder = StringBuilder("$apiBaseUrl/patients/$patientId/observations?")
            vitalType?.let { urlBuilder.append("vitalType=${it.name}&") }
            startDate?.let { urlBuilder.append("startDate=$it&") }
            endDate?.let { urlBuilder.append("endDate=$it&") }

            val request = Request.Builder()
                .url(urlBuilder.toString())
                .header("Authorization", "Bearer $token")
                .get()
                .build()

            val response = httpClient.newCall(request).execute()
            if (!response.isSuccessful) return@withContext emptyList()

            val json = JSONObject(response.body?.string() ?: return@withContext emptyList())
            val observations = json.getJSONArray("observations")
            parseObservations(observations)
        } catch (e: Exception) {
            emptyList()
        }
    }

    /**
     * Fetch thresholds for a patient.
     */
    suspend fun getThresholds(patientId: String): List<VitalThreshold> = withContext(Dispatchers.IO) {
        try {
            val token = authRepository.getAccessToken() ?: return@withContext emptyList()

            val request = Request.Builder()
                .url("$apiBaseUrl/patients/$patientId/thresholds")
                .header("Authorization", "Bearer $token")
                .get()
                .build()

            val response = httpClient.newCall(request).execute()
            if (!response.isSuccessful) return@withContext emptyList()

            val json = JSONObject(response.body?.string() ?: return@withContext emptyList())
            val thresholds = json.getJSONArray("thresholds")
            parseThresholds(thresholds)
        } catch (e: Exception) {
            emptyList()
        }
    }

    /**
     * Update thresholds for a patient.
     */
    suspend fun updateThreshold(
        patientId: String,
        threshold: VitalThreshold
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val token = authRepository.getAccessToken() ?: return@withContext false

            val body = JSONObject().apply {
                put("vitalType", threshold.vitalType.name)
                put("minValue", threshold.minValue)
                put("maxValue", threshold.maxValue)
                put("unit", threshold.unit)
            }.toString()

            val request = Request.Builder()
                .url("$apiBaseUrl/patients/$patientId/thresholds")
                .header("Authorization", "Bearer $token")
                .header("Content-Type", "application/json")
                .put(body.toRequestBody("application/json".toMediaType()))
                .build()

            val response = httpClient.newCall(request).execute()
            response.isSuccessful
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Update thresholds with individual parameters.
     */
    suspend fun updateThreshold(
        patientId: String,
        vitalType: VitalType,
        minValue: Double?,
        maxValue: Double?
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val token = authRepository.getAccessToken() ?: return@withContext false

            val body = JSONObject().apply {
                put("vitalType", vitalType.name)
                minValue?.let { put("minValue", it) }
                maxValue?.let { put("maxValue", it) }
            }.toString()

            val request = Request.Builder()
                .url("$apiBaseUrl/patients/$patientId/thresholds")
                .header("Authorization", "Bearer $token")
                .header("Content-Type", "application/json")
                .put(body.toRequestBody("application/json".toMediaType()))
                .build()

            val response = httpClient.newCall(request).execute()
            response.isSuccessful
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Fetch reminder configuration for a patient.
     */
    suspend fun getReminderConfig(patientId: String): List<ReminderConfig> = withContext(Dispatchers.IO) {
        try {
            val token = authRepository.getAccessToken() ?: return@withContext emptyList()

            val request = Request.Builder()
                .url("$apiBaseUrl/patients/$patientId/reminders")
                .header("Authorization", "Bearer $token")
                .get()
                .build()

            val response = httpClient.newCall(request).execute()
            if (!response.isSuccessful) return@withContext emptyList()

            val json = JSONObject(response.body?.string() ?: return@withContext emptyList())
            val reminders = json.getJSONArray("reminders")
            parseReminderConfigs(reminders)
        } catch (e: Exception) {
            emptyList()
        }
    }

    /**
     * Update reminder configuration.
     */
    suspend fun updateReminderConfig(
        patientId: String,
        config: ReminderConfig
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val token = authRepository.getAccessToken() ?: return@withContext false

            val body = JSONObject().apply {
                put("vitalType", config.vitalType.name)
                put("windowHours", config.windowHours)
                put("gracePeriodMinutes", config.gracePeriodMinutes)
                put("enabled", config.enabled)
            }.toString()

            val request = Request.Builder()
                .url("$apiBaseUrl/patients/$patientId/reminders")
                .header("Authorization", "Bearer $token")
                .header("Content-Type", "application/json")
                .put(body.toRequestBody("application/json".toMediaType()))
                .build()

            val response = httpClient.newCall(request).execute()
            response.isSuccessful
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Update reminder configuration with individual parameters.
     */
    suspend fun updateReminderConfig(
        patientId: String,
        vitalType: VitalType,
        windowHours: Int,
        gracePeriodMinutes: Int,
        enabled: Boolean
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val token = authRepository.getAccessToken() ?: return@withContext false

            val body = JSONObject().apply {
                put("vitalType", vitalType.name)
                put("windowHours", windowHours)
                put("gracePeriodMinutes", gracePeriodMinutes)
                put("enabled", enabled)
            }.toString()

            val request = Request.Builder()
                .url("$apiBaseUrl/patients/$patientId/reminders")
                .header("Authorization", "Bearer $token")
                .header("Content-Type", "application/json")
                .put(body.toRequestBody("application/json".toMediaType()))
                .build()

            val response = httpClient.newCall(request).execute()
            response.isSuccessful
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Fetch alerts for a patient.
     */
    suspend fun getAlerts(
        patientId: String,
        unreadOnly: Boolean = false
    ): List<Alert> = withContext(Dispatchers.IO) {
        try {
            val token = authRepository.getAccessToken() ?: return@withContext emptyList()

            val url = if (unreadOnly) {
                "$apiBaseUrl/patients/$patientId/alerts?unreadOnly=true"
            } else {
                "$apiBaseUrl/patients/$patientId/alerts"
            }

            val request = Request.Builder()
                .url(url)
                .header("Authorization", "Bearer $token")
                .get()
                .build()

            val response = httpClient.newCall(request).execute()
            if (!response.isSuccessful) return@withContext emptyList()

            val json = JSONObject(response.body?.string() ?: return@withContext emptyList())
            val alerts = json.getJSONArray("alerts")
            parseAlerts(alerts)
        } catch (e: Exception) {
            emptyList()
        }
    }

    /**
     * Mark an alert as read.
     */
    suspend fun markAlertAsRead(alertId: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val token = authRepository.getAccessToken() ?: return@withContext false

            val body = JSONObject().apply {
                put("read", true)
            }.toString()

            val request = Request.Builder()
                .url("$apiBaseUrl/alerts/$alertId")
                .header("Authorization", "Bearer $token")
                .header("Content-Type", "application/json")
                .patch(body.toRequestBody("application/json".toMediaType()))
                .build()

            val response = httpClient.newCall(request).execute()
            response.isSuccessful
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Fetch care team for a patient.
     */
    suspend fun getCareTeam(patientId: String): CareTeam? = withContext(Dispatchers.IO) {
        try {
            val token = authRepository.getAccessToken() ?: return@withContext null

            val request = Request.Builder()
                .url("$apiBaseUrl/patients/$patientId/care-team")
                .header("Authorization", "Bearer $token")
                .get()
                .build()

            val response = httpClient.newCall(request).execute()
            if (!response.isSuccessful) return@withContext null

            val json = JSONObject(response.body?.string() ?: return@withContext null)
            parseCareTeam(json)
        } catch (e: Exception) {
            null
        }
    }

    // Parsing helpers

    private fun parsePatientSummary(json: JSONObject): PatientSummary {
        val latestVitals = mutableMapOf<VitalType, LatestVital>()

        if (json.has("latestVitals")) {
            val vitalsJson = json.getJSONObject("latestVitals")
            VitalType.entries.forEach { type ->
                if (vitalsJson.has(type.name.lowercase())) {
                    val vitalJson = vitalsJson.getJSONObject(type.name.lowercase())
                    latestVitals[type] = LatestVital(
                        value = vitalJson.getDouble("value"),
                        unit = vitalJson.optString("unit", ""),
                        timestamp = Instant.parse(vitalJson.getString("timestamp")),
                        status = ThresholdStatus.valueOf(
                            vitalJson.optString("status", "NORMAL").uppercase()
                        ),
                        secondaryValue = vitalJson.optDouble("secondaryValue").takeIf { !it.isNaN() }
                    )
                }
            }
        }

        return PatientSummary(
            patientId = json.getString("patientId"),
            patientName = json.getString("patientName"),
            latestVitals = latestVitals,
            unreadAlertCount = json.optInt("unreadAlertCount", 0),
            lastActivityTime = json.optString("lastActivityTime")?.let {
                if (it.isNotEmpty()) Instant.parse(it) else null
            }
        )
    }

    private fun parseObservations(array: JSONArray): List<VitalObservation> {
        return (0 until array.length()).map { i ->
            val obj = array.getJSONObject(i)
            VitalObservation(
                id = obj.getString("id"),
                vitalType = VitalType.valueOf(obj.getString("vitalType").uppercase()),
                value = obj.getDouble("value"),
                secondaryValue = obj.optDouble("secondaryValue").takeIf { !it.isNaN() },
                unit = obj.getString("unit"),
                timestamp = Instant.parse(obj.getString("timestamp")),
                performerName = obj.optString("performerName"),
                status = ThresholdStatus.valueOf(obj.optString("status", "NORMAL").uppercase())
            )
        }
    }

    private fun parseThresholds(array: JSONArray): List<VitalThreshold> {
        return (0 until array.length()).map { i ->
            val obj = array.getJSONObject(i)
            VitalThreshold(
                vitalType = VitalType.valueOf(obj.getString("vitalType").uppercase()),
                minValue = obj.optDouble("minValue").takeIf { !it.isNaN() },
                maxValue = obj.optDouble("maxValue").takeIf { !it.isNaN() },
                unit = obj.getString("unit"),
                setByDoctor = obj.optBoolean("setByDoctor", false),
                doctorName = obj.optString("doctorName").takeIf { it.isNotEmpty() }
            )
        }
    }

    private fun parseReminderConfigs(array: JSONArray): List<ReminderConfig> {
        return (0 until array.length()).map { i ->
            val obj = array.getJSONObject(i)
            ReminderConfig(
                vitalType = VitalType.valueOf(obj.getString("vitalType").uppercase()),
                windowHours = obj.getInt("windowHours"),
                gracePeriodMinutes = obj.getInt("gracePeriodMinutes"),
                enabled = obj.optBoolean("enabled", true)
            )
        }
    }

    private fun parseAlerts(array: JSONArray): List<Alert> {
        return (0 until array.length()).map { i ->
            val obj = array.getJSONObject(i)
            Alert(
                id = obj.getString("id"),
                alertType = AlertType.valueOf(obj.getString("alertType").uppercase()),
                vitalType = obj.optString("vitalType").takeIf { it.isNotEmpty() }
                    ?.let { VitalType.valueOf(it.uppercase()) },
                value = obj.optDouble("value").takeIf { !it.isNaN() },
                message = obj.getString("message"),
                timestamp = Instant.parse(obj.getString("timestamp")),
                read = obj.optBoolean("read", false)
            )
        }
    }

    private fun parseCareTeam(json: JSONObject): CareTeam {
        val attendants = mutableListOf<CareTeamMember>()
        val doctors = mutableListOf<CareTeamMember>()
        val relatives = mutableListOf<CareTeamMember>()
        val pendingInvites = mutableListOf<PendingInvite>()

        json.optJSONArray("attendants")?.let { array ->
            (0 until array.length()).forEach { i ->
                val obj = array.getJSONObject(i)
                attendants.add(parseCareTeamMember(obj))
            }
        }

        json.optJSONArray("doctors")?.let { array ->
            (0 until array.length()).forEach { i ->
                val obj = array.getJSONObject(i)
                doctors.add(parseCareTeamMember(obj))
            }
        }

        json.optJSONArray("relatives")?.let { array ->
            (0 until array.length()).forEach { i ->
                val obj = array.getJSONObject(i)
                relatives.add(parseCareTeamMember(obj))
            }
        }

        json.optJSONArray("pendingInvites")?.let { array ->
            (0 until array.length()).forEach { i ->
                val obj = array.getJSONObject(i)
                pendingInvites.add(
                    PendingInvite(
                        id = obj.getString("id"),
                        email = obj.getString("email"),
                        role = obj.getString("role"),
                        sentAt = Instant.parse(obj.getString("sentAt"))
                    )
                )
            }
        }

        return CareTeam(
            attendants = attendants,
            doctors = doctors,
            relatives = relatives,
            pendingInvites = pendingInvites
        )
    }

    private fun parseCareTeamMember(json: JSONObject): CareTeamMember {
        return CareTeamMember(
            id = json.getString("id"),
            name = json.getString("name"),
            email = json.optString("email"),
            phone = json.optString("phone"),
            role = json.getString("role"),
            joinedAt = json.optString("joinedAt")?.let {
                if (it.isNotEmpty()) Instant.parse(it) else null
            }
        )
    }
}

// Data classes

enum class VitalType(val displayName: String) {
    BLOOD_PRESSURE("Blood Pressure"),
    GLUCOSE("Glucose"),
    TEMPERATURE("Temperature"),
    WEIGHT("Weight"),
    PULSE("Pulse"),
    SPO2("SpO2")
}

enum class ThresholdStatus {
    NORMAL,
    LOW,
    HIGH,
    CRITICAL
}

enum class AlertType {
    THRESHOLD_BREACH,
    REMINDER_LAPSE,
    SYSTEM
}

data class PatientSummary(
    val patientId: String,
    val patientName: String,
    val latestVitals: Map<VitalType, LatestVital>,
    val unreadAlertCount: Int,
    val lastActivityTime: Instant?
)

data class LatestVital(
    val value: Double,
    val unit: String,
    val timestamp: Instant,
    val status: ThresholdStatus,
    val secondaryValue: Double? = null // For BP diastolic
)

data class VitalObservation(
    val id: String,
    val vitalType: VitalType,
    val value: Double,
    val secondaryValue: Double?,
    val unit: String,
    val timestamp: Instant,
    val performerName: String?,
    val status: ThresholdStatus
)

data class VitalThreshold(
    val vitalType: VitalType,
    val minValue: Double?,
    val maxValue: Double?,
    val unit: String,
    val setByDoctor: Boolean = false,
    val doctorName: String? = null
)

data class ReminderConfig(
    val vitalType: VitalType,
    val windowHours: Int,
    val gracePeriodMinutes: Int,
    val enabled: Boolean = true
)

data class Alert(
    val id: String,
    val alertType: AlertType,
    val vitalType: VitalType?,
    val value: Double?,
    val message: String,
    val timestamp: Instant,
    val read: Boolean
)

data class CareTeam(
    val attendants: List<CareTeamMember>,
    val doctors: List<CareTeamMember>,
    val relatives: List<CareTeamMember>,
    val pendingInvites: List<PendingInvite>
)

data class CareTeamMember(
    val id: String,
    val name: String,
    val email: String?,
    val phone: String?,
    val role: String,
    val joinedAt: Instant?
)

data class PendingInvite(
    val id: String,
    val email: String,
    val role: String,
    val sentAt: Instant
)
