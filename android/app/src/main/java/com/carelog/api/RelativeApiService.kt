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
import com.carelog.BuildConfig
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

    private val apiBaseUrl = BuildConfig.API_BASE_URL

    /**
     * Fetch patient summary including latest vitals.
     */
    /**
     * Fetch patient summary including latest vitals.
     * Throws on error so callers can report the issue.
     */
    suspend fun getPatientSummary(patientId: String): PatientSummary = withContext(Dispatchers.IO) {
        val token = authRepository.getAccessToken()
            ?: throw Exception("No auth token available")

        val request = Request.Builder()
            .url("$apiBaseUrl/patients/$patientId/summary")
            .header("Authorization", "Bearer $token")
            .get()
            .build()

        val response = httpClient.newCall(request).execute()
        val responseBody = response.body.string()

        if (!response.isSuccessful) {
            throw Exception("API ${response.code}: $responseBody")
        }

        val json = JSONObject(responseBody)
        parsePatientSummary(json)
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
        val token = authRepository.getAccessToken()
            ?: throw Exception("No auth token available")

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
        val responseBody = response.body.string()

        if (!response.isSuccessful) {
            throw Exception("API ${response.code}: $responseBody")
        }

        val json = JSONObject(responseBody)
        val observations = json.getJSONArray("observations")
        parseObservations(observations)
    }

    /**
     * F26 — Fetch threshold rows from the v2 `parameter_configs` table
     * (the table that actually drives `evaluate-thresholds-batch` alerts).
     *
     * The legacy v1 `getThresholds` below points at `/patients/{id}/thresholds`
     * which is unwired in API Gateway and would target the dormant v1
     * `thresholds` table even if it were wired. ThresholdConfigScreen now
     * calls THIS method instead. The legacy method is kept for any caller
     * that still references it; will be removed when no callers remain.
     *
     * One row per parameter_configs entry — BP comes back as two rows
     * (blood_pressure_systolic + blood_pressure_diastolic) because the
     * v2 schema separates them. The screen iterates parameter_name strings.
     */
    suspend fun getParameterThresholds(
        patientId: String,
    ): List<ParameterThreshold> = withContext(Dispatchers.IO) {
        val token = authRepository.getAccessToken()
            ?: throw Exception("No auth token available")

        val request = Request.Builder()
            .url("$apiBaseUrl/patients/$patientId/parameter-configs")
            .header("Authorization", "Bearer $token")
            .get()
            .build()

        val response = httpClient.newCall(request).execute()
        val responseBody = response.body.string()

        if (!response.isSuccessful) {
            throw Exception("API ${response.code}: $responseBody")
        }

        val json = JSONObject(responseBody)
        val configs = json.getJSONArray("parameter_configs")
        parseParameterThresholds(configs)
    }

    /**
     * F26 — Update one parameter_configs row's threshold_min/max via
     * PUT /patients/{id}/parameter-configs/{configId}. Server-side
     * `manage-parameter-configs` keeps `threshold_set_by` aligned to
     * the caller's role (caregiver vs doctor); we only send the two
     * threshold values.
     */
    suspend fun updateParameterThreshold(
        patientId: String,
        configId: String,
        minValue: Double?,
        maxValue: Double?,
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val token = authRepository.getAccessToken() ?: return@withContext false

            val body = JSONObject().apply {
                // parameter_configs.threshold_min/max are numeric arrays in
                // the schema. Send as JSON arrays so the API layer's
                // pg-compatible binding keeps the expected shape.
                put("threshold_min", JSONArray().apply { minValue?.let { put(it) } })
                put("threshold_max", JSONArray().apply { maxValue?.let { put(it) } })
            }.toString()

            val request = Request.Builder()
                .url("$apiBaseUrl/patients/$patientId/parameter-configs/$configId")
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

    private fun parseParameterThresholds(jsonArray: JSONArray): List<ParameterThreshold> {
        val list = mutableListOf<ParameterThreshold>()
        for (i in 0 until jsonArray.length()) {
            val obj = jsonArray.getJSONObject(i)
            val parameterName = obj.getString("parameter_name")
            // threshold_min / threshold_max come back as either a Postgres
            // text array string ("{90}") or a JSON array ([90]). Both shapes
            // coerce via firstNumericInsideArrayLike. Empty / absent → null.
            val minValue = firstNumericInsideArrayLike(obj.opt("threshold_min"))
            val maxValue = firstNumericInsideArrayLike(obj.opt("threshold_max"))
            list.add(
                ParameterThreshold(
                    configId = obj.getString("id"),
                    parameterName = parameterName,
                    displayName = obj.optString("display_name", humanizeParameterName(parameterName)),
                    minValue = minValue,
                    maxValue = maxValue,
                    unit = obj.optString("unit", ""),
                    setByDoctor = !obj.isNull("threshold_set_by"),
                ),
            )
        }
        return list
    }

    private fun firstNumericInsideArrayLike(value: Any?): Double? {
        if (value == null || value == JSONObject.NULL) return null
        return when (value) {
            is JSONArray -> if (value.length() > 0) value.optDouble(0).takeIf { !it.isNaN() } else null
            is String -> {
                // "{90,160}" or "{}" — strip braces, take first numeric chunk.
                val trimmed = value.trim('{', '}', ' ')
                if (trimmed.isEmpty()) null else trimmed.substringBefore(',').toDoubleOrNull()
            }
            is Number -> value.toDouble()
            else -> null
        }
    }

    private fun humanizeParameterName(name: String): String =
        name.split('_').joinToString(" ") { it.replaceFirstChar(Char::uppercaseChar) }

    /**
     * Fetch thresholds for a patient.
     */
    @Deprecated(
        "Use getParameterThresholds() — wires to v2 parameter_configs. " +
            "This method points at the unwired v1 /patients/{id}/thresholds route.",
        ReplaceWith("getParameterThresholds(patientId)"),
    )
    suspend fun getThresholds(patientId: String): List<VitalThreshold> = withContext(Dispatchers.IO) {
        val token = authRepository.getAccessToken()
            ?: throw Exception("No auth token available")

        val request = Request.Builder()
            .url("$apiBaseUrl/patients/$patientId/thresholds")
            .header("Authorization", "Bearer $token")
            .get()
            .build()

        val response = httpClient.newCall(request).execute()
        val responseBody = response.body.string()

        if (!response.isSuccessful) {
            throw Exception("API ${response.code}: $responseBody")
        }

        val json = JSONObject(responseBody)
        val thresholds = json.getJSONArray("thresholds")
        parseThresholds(thresholds)
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
        val token = authRepository.getAccessToken()
            ?: throw Exception("No auth token available")

        val request = Request.Builder()
            .url("$apiBaseUrl/patients/$patientId/reminders")
            .header("Authorization", "Bearer $token")
            .get()
            .build()

        val response = httpClient.newCall(request).execute()
        val responseBody = response.body.string()

        if (!response.isSuccessful) {
            throw Exception("API ${response.code}: $responseBody")
        }

        val json = JSONObject(responseBody)
        val reminders = json.getJSONArray("reminders")
        parseReminderConfigs(reminders)
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
        val token = authRepository.getAccessToken()
            ?: throw Exception("No auth token available")

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
        val responseBody = response.body.string()

        if (!response.isSuccessful) {
            throw Exception("API ${response.code}: $responseBody")
        }

        val json = JSONObject(responseBody)
        val alerts = json.getJSONArray("alerts")
        parseAlerts(alerts)
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
     * Delete a patient and cascade-remove all associated personas (attendants, doctors).
     */
    suspend fun deletePatient(patientId: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val token = authRepository.getAccessToken() ?: return@withContext false

            val request = Request.Builder()
                .url("$apiBaseUrl/patients/$patientId")
                .header("Authorization", "Bearer $token")
                .delete()
                .build()

            val response = httpClient.newCall(request).execute()
            response.isSuccessful
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Remove a team member (attendant or doctor) from a patient's care team.
     * This disables their account and sends them a notification email.
     */
    suspend fun removeTeamMember(patientId: String, memberId: String): Boolean = withContext(Dispatchers.IO) {
        val token = authRepository.getAccessToken()
            ?: throw Exception("No auth token available")

        val request = Request.Builder()
            .url("$apiBaseUrl/patients/$patientId/team/$memberId")
            .header("Authorization", "Bearer $token")
            .delete()
            .build()

        val response = httpClient.newCall(request).execute()
        val responseBody = response.body.string()
        if (!response.isSuccessful) {
            throw Exception("API ${response.code}: $responseBody")
        }
        true
    }

    /**
     * Fetch care team for a patient.
     */
    suspend fun getCareTeam(patientId: String): CareTeam = withContext(Dispatchers.IO) {
        val token = authRepository.getAccessToken()
            ?: throw Exception("No auth token available")

        val request = Request.Builder()
            .url("$apiBaseUrl/patients/$patientId/care-team")
            .header("Authorization", "Bearer $token")
            .get()
            .build()

        val response = httpClient.newCall(request).execute()
        val responseBody = response.body.string()

        if (!response.isSuccessful) {
            throw Exception("API ${response.code}: $responseBody")
        }

        val json = JSONObject(responseBody)
        parseCareTeam(json)
    }

    /**
     * Send an attendant invite for a patient.
     */
    suspend fun sendAttendantInvite(patientId: String, name: String, email: String): Boolean = withContext(Dispatchers.IO) {
        val token = authRepository.getAccessToken()
            ?: throw Exception("No auth token available")

        val body = JSONObject().apply {
            put("patientId", patientId)
            put("attendantName", name)
            put("email", email)
        }.toString()

        val request = Request.Builder()
            .url("$apiBaseUrl/invites/attendant")
            .header("Authorization", "Bearer $token")
            .header("Content-Type", "application/json")
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()

        val response = httpClient.newCall(request).execute()
        val responseBody = response.body.string()

        if (!response.isSuccessful) {
            throw Exception("API ${response.code}: $responseBody")
        }

        true
    }

    /**
     * Fetch audit logs for a patient with optional filters and pagination.
     */
    suspend fun getAuditLogs(
        patientId: String,
        page: Int = 0,
        pageSize: Int = 20,
        actorId: String? = null,
        action: String? = null,
        resourceType: String? = null
    ): AuditLogResponse = withContext(Dispatchers.IO) {
        val token = authRepository.getAccessToken()
            ?: throw Exception("No auth token available")

        val urlBuilder = StringBuilder("$apiBaseUrl/audit-log?patientId=$patientId")
        urlBuilder.append("&page=$page")
        urlBuilder.append("&pageSize=$pageSize")
        actorId?.let { urlBuilder.append("&actorId=$it") }
        action?.let { urlBuilder.append("&action=$it") }
        resourceType?.let { urlBuilder.append("&resourceType=$it") }

        val request = Request.Builder()
            .url(urlBuilder.toString())
            .header("Authorization", "Bearer $token")
            .get()
            .build()

        val response = httpClient.newCall(request).execute()
        val responseBody = response.body.string()

        if (!response.isSuccessful) {
            throw Exception("API ${response.code}: $responseBody")
        }

        val json = JSONObject(responseBody)
        val logsArray = json.optJSONArray("logs") ?: JSONArray()
        val logs = (0 until logsArray.length()).map { i ->
            val obj = logsArray.getJSONObject(i)
            AuditLogEntryDto(
                id = obj.getString("id"),
                action = obj.getString("action"),
                resourceType = obj.optString("resourceType", ""),
                resourceId = obj.optString("resourceId").takeIf { it.isNotEmpty() },
                actorId = obj.getString("actorId"),
                actorName = obj.getString("actorName"),
                actorRole = obj.getString("actorRole"),
                timestamp = obj.getString("timestamp")
            )
        }

        val actorsArray = json.optJSONArray("actors") ?: JSONArray()
        val actors = (0 until actorsArray.length()).map { i ->
            val obj = actorsArray.getJSONObject(i)
            AuditActorDto(
                id = obj.getString("id"),
                name = obj.getString("name"),
                role = obj.getString("role")
            )
        }

        AuditLogResponse(
            logs = logs,
            actors = actors,
            hasMore = json.optBoolean("hasMore", false),
            total = json.optInt("total", logs.size)
        )
    }

    /**
     * Cancel a pending invite.
     */
    suspend fun cancelInvite(patientId: String, inviteId: String): Boolean = withContext(Dispatchers.IO) {
        val token = authRepository.getAccessToken()
            ?: throw Exception("No auth token available")

        val body = JSONObject().apply {
            put("inviteId", inviteId)
        }.toString()

        val request = Request.Builder()
            .url("$apiBaseUrl/patients/$patientId/care-team?inviteId=$inviteId")
            .header("Authorization", "Bearer $token")
            .header("Content-Type", "application/json")
            .delete(body.toRequestBody("application/json".toMediaType()))
            .build()

        val response = httpClient.newCall(request).execute()
        val responseBody = response.body.string()
        if (!response.isSuccessful) {
            throw Exception("API ${response.code}: $responseBody")
        }
        true
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
            lastActivityTime = json.optString("lastActivityTime", "").let {
                if (it.isNotEmpty() && it != "null") Instant.parse(it) else null
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
                performerName = obj.optString("performerName", "").takeIf { it.isNotEmpty() && it != "null" },
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

/**
 * F26 — v2 threshold model backed by `parameter_configs`. One row per
 * configured parameter (BP splits into systolic + diastolic). Used by
 * ThresholdConfigScreen via `RelativeApiService.getParameterThresholds`.
 *
 * `parameterName` matches the database `vital_type` enum
 * (e.g. `blood_pressure_systolic`); `displayName` is the human-readable
 * label written when the protocol-extraction pass persists the row
 * (see `manage-parameter-configs` POST).
 */
data class ParameterThreshold(
    val configId: String,
    val parameterName: String,
    val displayName: String,
    val minValue: Double?,
    val maxValue: Double?,
    val unit: String,
    val setByDoctor: Boolean = false,
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

data class AuditLogEntryDto(
    val id: String,
    val action: String,
    val resourceType: String,
    val resourceId: String?,
    val actorId: String,
    val actorName: String,
    val actorRole: String,
    val timestamp: String
)

data class AuditActorDto(
    val id: String,
    val name: String,
    val role: String
)

data class AuditLogResponse(
    val logs: List<AuditLogEntryDto>,
    val actors: List<AuditActorDto>,
    val hasMore: Boolean,
    val total: Int
)
