package com.carelog.fhir.client

import com.carelog.auth.AuthRepository
import com.carelog.fhir.models.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import java.net.HttpURLConnection
import java.net.URL
import javax.inject.Inject
import javax.inject.Singleton

/**
 * AWS HealthLake implementation of FhirClient.
 *
 * Provides CRUD operations for FHIR resources via API Gateway,
 * which proxies to HealthLake.
 */
@Singleton
class HealthLakeFhirClient @Inject constructor(
    private val authRepository: AuthRepository,
    private val config: FhirClientConfig
) : FhirClient {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    /**
     * Maps FHIR resource paths to API Gateway routes.
     * The API Gateway uses REST-style routes, not FHIR-style paths.
     */
    private fun mapPath(fhirPath: String): String {
        return when {
            fhirPath == "Observation" -> "observations/sync"
            fhirPath.startsWith("Observation/") -> "observations/sync"
            fhirPath == "Patient" -> "patients"
            fhirPath.startsWith("Patient/") -> "patients/${fhirPath.removePrefix("Patient/")}"
            fhirPath == "DocumentReference" -> "documents"
            fhirPath.startsWith("DocumentReference/") -> "documents/${fhirPath.removePrefix("DocumentReference/")}"
            fhirPath == "CarePlan" -> "care-plans"
            fhirPath.startsWith("CarePlan/") -> "care-plans/${fhirPath.removePrefix("CarePlan/")}"
            fhirPath.startsWith("Observation?") -> "observations/sync?${fhirPath.removePrefix("Observation?")}"
            fhirPath.startsWith("DocumentReference?") -> "documents?${fhirPath.removePrefix("DocumentReference?")}"
            fhirPath.startsWith("CarePlan?") -> "care-plans?${fhirPath.removePrefix("CarePlan?")}"
            else -> fhirPath
        }
    }

    // ==================== Patient Operations ====================

    override suspend fun createPatient(patient: FhirPatient): String {
        val response = post("Patient", patient.toFhirJson())
        return response["id"]?.jsonPrimitive?.content
            ?: throw FhirClientException("Failed to create patient: no ID returned")
    }

    override suspend fun getPatient(patientId: String): FhirPatient? {
        val response = get("Patient/$patientId")
        return response?.let { parsePatient(it) }
    }

    override suspend fun updatePatient(patient: FhirPatient): Boolean {
        val id = patient.id ?: throw FhirClientException("Patient ID required for update")
        put("Patient/$id", patient.toFhirJson())
        return true
    }

    override suspend fun deletePatient(patientId: String): Boolean {
        delete("Patient/$patientId")
        return true
    }

    // ==================== Observation Operations ====================

    override suspend fun createObservation(observation: FhirObservation): String {
        val response = post("Observation", observation.toFhirJson())
        return response["id"]?.jsonPrimitive?.content
            ?: throw FhirClientException("Failed to create observation: no ID returned")
    }

    override suspend fun getObservation(observationId: String): FhirObservation? {
        val response = get("Observation/$observationId")
        return response?.let { parseObservation(it) }
    }

    override suspend fun getObservationsForPatient(
        patientId: String,
        type: ObservationType?,
        startDate: String?,
        endDate: String?,
        limit: Int
    ): List<FhirObservation> {
        val params = mutableListOf<String>()
        params.add("subject=Patient/$patientId")
        type?.let { params.add("code=${it.loincCode}") }
        startDate?.let { params.add("date=ge$it") }
        endDate?.let { params.add("date=le$it") }
        params.add("_count=$limit")
        params.add("_sort=-date")

        val queryString = params.joinToString("&")
        val response = get("Observation?$queryString")

        return response?.let { bundle ->
            val entries = bundle["entry"]?.jsonArray ?: return emptyList()
            entries.mapNotNull { entry ->
                val resource = entry.jsonObject["resource"]?.jsonObject
                resource?.let { parseObservation(it) }
            }
        } ?: emptyList()
    }

    override suspend fun deleteObservation(observationId: String): Boolean {
        delete("Observation/$observationId")
        return true
    }

    // ==================== DocumentReference Operations ====================

    override suspend fun createDocumentReference(document: FhirDocumentReference): String {
        val response = post("DocumentReference", document.toFhirJson())
        return response["id"]?.jsonPrimitive?.content
            ?: throw FhirClientException("Failed to create document reference: no ID returned")
    }

    override suspend fun getDocumentReference(documentId: String): FhirDocumentReference? {
        val response = get("DocumentReference/$documentId")
        return response?.let { parseDocumentReference(it) }
    }

    override suspend fun getDocumentsForPatient(
        patientId: String,
        type: DocumentType?,
        limit: Int
    ): List<FhirDocumentReference> {
        val params = mutableListOf<String>()
        params.add("subject=Patient/$patientId")
        type?.let { params.add("type=${it.code}") }
        params.add("_count=$limit")
        params.add("_sort=-date")

        val queryString = params.joinToString("&")
        val response = get("DocumentReference?$queryString")

        return response?.let { bundle ->
            val entries = bundle["entry"]?.jsonArray ?: return emptyList()
            entries.mapNotNull { entry ->
                val resource = entry.jsonObject["resource"]?.jsonObject
                resource?.let { parseDocumentReference(it) }
            }
        } ?: emptyList()
    }

    override suspend fun deleteDocumentReference(documentId: String): Boolean {
        delete("DocumentReference/$documentId")
        return true
    }

    // ==================== CarePlan Operations ====================

    override suspend fun createCarePlan(carePlan: FhirCarePlan): String {
        val response = post("CarePlan", carePlan.toFhirJson())
        return response["id"]?.jsonPrimitive?.content
            ?: throw FhirClientException("Failed to create care plan: no ID returned")
    }

    override suspend fun getCarePlan(carePlanId: String): FhirCarePlan? {
        val response = get("CarePlan/$carePlanId")
        return response?.let { parseCarePlan(it) }
    }

    override suspend fun getCarePlansForPatient(patientId: String): List<FhirCarePlan> {
        val response = get("CarePlan?subject=Patient/$patientId&status=active")

        return response?.let { bundle ->
            val entries = bundle["entry"]?.jsonArray ?: return emptyList()
            entries.mapNotNull { entry ->
                val resource = entry.jsonObject["resource"]?.jsonObject
                resource?.let { parseCarePlan(it) }
            }
        } ?: emptyList()
    }

    override suspend fun updateCarePlan(carePlan: FhirCarePlan): Boolean {
        val id = carePlan.id ?: throw FhirClientException("CarePlan ID required for update")
        put("CarePlan/$id", carePlan.toFhirJson())
        return true
    }

    override suspend fun deleteCarePlan(carePlanId: String): Boolean {
        delete("CarePlan/$carePlanId")
        return true
    }

    // ==================== HTTP Methods ====================

    private suspend fun get(path: String): JsonObject? = withContext(Dispatchers.IO) {
        val url = URL("${config.baseUrl}/${mapPath(path)}")
        val connection = url.openConnection() as HttpURLConnection

        try {
            connection.requestMethod = "GET"
            connection.setRequestProperty("Authorization", "Bearer ${getAccessToken()}")
            connection.setRequestProperty("Accept", "application/fhir+json")

            when (connection.responseCode) {
                HttpURLConnection.HTTP_OK -> {
                    val response = connection.inputStream.bufferedReader().readText()
                    json.parseToJsonElement(response).jsonObject
                }
                HttpURLConnection.HTTP_NOT_FOUND -> null
                else -> throw FhirClientException(
                    "GET $path failed: ${connection.responseCode} ${connection.responseMessage}"
                )
            }
        } finally {
            connection.disconnect()
        }
    }

    private suspend fun post(path: String, body: Map<String, Any>): JsonObject =
        withContext(Dispatchers.IO) {
            val url = URL("${config.baseUrl}/${mapPath(path)}")
            val connection = url.openConnection() as HttpURLConnection

            try {
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Authorization", "Bearer ${getAccessToken()}")
                connection.setRequestProperty("Content-Type", "application/fhir+json")
                connection.setRequestProperty("Accept", "application/fhir+json")

                val jsonBody = json.encodeToString(JsonObject.serializer(), body.toJsonObject())
                connection.outputStream.bufferedWriter().use { it.write(jsonBody) }

                if (connection.responseCode in 200..299) {
                    val response = connection.inputStream.bufferedReader().readText()
                    json.parseToJsonElement(response).jsonObject
                } else {
                    val error = connection.errorStream?.bufferedReader()?.readText() ?: ""
                    throw FhirClientException(
                        "POST $path failed: ${connection.responseCode} $error"
                    )
                }
            } finally {
                connection.disconnect()
            }
        }

    private suspend fun put(path: String, body: Map<String, Any>): JsonObject =
        withContext(Dispatchers.IO) {
            val url = URL("${config.baseUrl}/${mapPath(path)}")
            val connection = url.openConnection() as HttpURLConnection

            try {
                connection.requestMethod = "PUT"
                connection.doOutput = true
                connection.setRequestProperty("Authorization", "Bearer ${getAccessToken()}")
                connection.setRequestProperty("Content-Type", "application/fhir+json")
                connection.setRequestProperty("Accept", "application/fhir+json")

                val jsonBody = json.encodeToString(JsonObject.serializer(), body.toJsonObject())
                connection.outputStream.bufferedWriter().use { it.write(jsonBody) }

                if (connection.responseCode in 200..299) {
                    val response = connection.inputStream.bufferedReader().readText()
                    json.parseToJsonElement(response).jsonObject
                } else {
                    val error = connection.errorStream?.bufferedReader()?.readText() ?: ""
                    throw FhirClientException(
                        "PUT $path failed: ${connection.responseCode} $error"
                    )
                }
            } finally {
                connection.disconnect()
            }
        }

    private suspend fun delete(path: String) = withContext(Dispatchers.IO) {
        val url = URL("${config.baseUrl}/${mapPath(path)}")
        val connection = url.openConnection() as HttpURLConnection

        try {
            connection.requestMethod = "DELETE"
            connection.setRequestProperty("Authorization", "Bearer ${getAccessToken()}")

            if (connection.responseCode !in 200..299) {
                throw FhirClientException(
                    "DELETE $path failed: ${connection.responseCode}"
                )
            }
        } finally {
            connection.disconnect()
        }
    }

    private suspend fun getAccessToken(): String {
        return authRepository.getAccessToken()
            ?: throw FhirClientException("Not authenticated")
    }

    // ==================== Parsing Methods ====================

    private fun parsePatient(json: JsonObject): FhirPatient {
        val id = json["id"]?.jsonPrimitive?.content
        val identifiers = json["identifier"]?.jsonArray
        val patientId = identifiers?.firstOrNull()?.jsonObject?.get("value")?.jsonPrimitive?.content
            ?: throw FhirClientException("Patient ID not found")

        val names = json["name"]?.jsonArray
        val name = names?.firstOrNull()?.jsonObject?.get("text")?.jsonPrimitive?.content ?: ""

        val gender = PatientGender.fromString(json["gender"]?.jsonPrimitive?.content)
        val birthDate = json["birthDate"]?.jsonPrimitive?.content

        val extensions = json["extension"]?.jsonArray
        val bloodType = extensions?.find {
            it.jsonObject["url"]?.jsonPrimitive?.content?.contains("blood-type") == true
        }?.jsonObject?.get("valueString")?.jsonPrimitive?.content

        val contacts = json["contact"]?.jsonArray
        val emergencyContact = contacts?.firstOrNull()?.jsonObject?.let { contact ->
            val contactName = contact["name"]?.jsonObject?.get("text")?.jsonPrimitive?.content
            val telecom = contact["telecom"]?.jsonArray?.firstOrNull()?.jsonObject
            val phone = telecom?.get("value")?.jsonPrimitive?.content
            contactName?.let { EmergencyContact(name = it, phone = phone) }
        }

        return FhirPatient(
            id = id,
            patientId = patientId,
            name = name,
            birthDate = birthDate,
            gender = gender,
            bloodType = bloodType,
            emergencyContact = emergencyContact,
            active = json["active"]?.jsonPrimitive?.boolean ?: true
        )
    }

    private fun parseObservation(json: JsonObject): FhirObservation {
        val id = json["id"]?.jsonPrimitive?.content
        val subject = json["subject"]?.jsonObject?.get("reference")?.jsonPrimitive?.content
        val patientId = subject?.removePrefix("Patient/") ?: ""

        val code = json["code"]?.jsonObject?.get("coding")?.jsonArray?.firstOrNull()?.jsonObject
        val loincCode = code?.get("code")?.jsonPrimitive?.content ?: ""
        val type = ObservationType.entries.find { it.loincCode == loincCode }
            ?: ObservationType.BODY_WEIGHT

        val effectiveDateTime = json["effectiveDateTime"]?.jsonPrimitive?.content ?: ""
        val status = ObservationStatus.entries.find {
            it.fhirCode == json["status"]?.jsonPrimitive?.content
        } ?: ObservationStatus.FINAL

        val valueQuantity = json["valueQuantity"]?.jsonObject
        val value = valueQuantity?.get("value")?.jsonPrimitive?.double
        val unit = valueQuantity?.get("unit")?.jsonPrimitive?.content

        val components = json["component"]?.jsonArray?.map { comp ->
            val compObj = comp.jsonObject
            val compCode = compObj["code"]?.jsonObject?.get("coding")?.jsonArray?.firstOrNull()?.jsonObject
            val compLoincCode = compCode?.get("code")?.jsonPrimitive?.content ?: ""
            val compType = ObservationType.entries.find { it.loincCode == compLoincCode }
                ?: ObservationType.SYSTOLIC_BP

            val compValue = compObj["valueQuantity"]?.jsonObject
            ObservationComponent(
                type = compType,
                value = compValue?.get("value")?.jsonPrimitive?.double ?: 0.0,
                unit = compValue?.get("unit")?.jsonPrimitive?.content ?: ""
            )
        }

        return FhirObservation(
            id = id,
            patientId = patientId,
            type = type,
            effectiveDateTime = effectiveDateTime,
            value = value,
            unit = unit,
            components = components,
            status = status
        )
    }

    private fun parseDocumentReference(json: JsonObject): FhirDocumentReference {
        val id = json["id"]?.jsonPrimitive?.content
        val identifiers = json["identifier"]?.jsonArray
        val documentId = identifiers?.firstOrNull()?.jsonObject?.get("value")?.jsonPrimitive?.content ?: ""

        val subject = json["subject"]?.jsonObject?.get("reference")?.jsonPrimitive?.content
        val patientId = subject?.removePrefix("Patient/") ?: ""

        val typeObj = json["type"]?.jsonObject?.get("coding")?.jsonArray?.firstOrNull()?.jsonObject
        val typeCode = typeObj?.get("code")?.jsonPrimitive?.content ?: "other"
        val type = DocumentType.entries.find { it.code == typeCode } ?: DocumentType.OTHER

        val date = json["date"]?.jsonPrimitive?.content ?: ""
        val description = json["description"]?.jsonPrimitive?.content

        val content = json["content"]?.jsonArray?.firstOrNull()?.jsonObject
        val attachment = content?.get("attachment")?.jsonObject
        val contentUrl = attachment?.get("url")?.jsonPrimitive?.content ?: ""
        val contentType = attachment?.get("contentType")?.jsonPrimitive?.content ?: ""
        val title = attachment?.get("title")?.jsonPrimitive?.content ?: ""
        val size = attachment?.get("size")?.jsonPrimitive?.long

        return FhirDocumentReference(
            id = id,
            patientId = patientId,
            documentId = documentId,
            type = type,
            title = title,
            description = description,
            contentUrl = contentUrl,
            contentType = contentType,
            size = size,
            date = date
        )
    }

    private fun parseCarePlan(json: JsonObject): FhirCarePlan {
        val id = json["id"]?.jsonPrimitive?.content
        val identifiers = json["identifier"]?.jsonArray
        val planId = identifiers?.firstOrNull()?.jsonObject?.get("value")?.jsonPrimitive?.content ?: ""

        val subject = json["subject"]?.jsonObject?.get("reference")?.jsonPrimitive?.content
        val patientId = subject?.removePrefix("Patient/") ?: ""

        val title = json["title"]?.jsonPrimitive?.content ?: ""
        val description = json["description"]?.jsonPrimitive?.content
        val status = CarePlanStatus.entries.find {
            it.fhirCode == json["status"]?.jsonPrimitive?.content
        } ?: CarePlanStatus.ACTIVE

        val period = json["period"]?.jsonObject
        val periodStart = period?.get("start")?.jsonPrimitive?.content
        val periodEnd = period?.get("end")?.jsonPrimitive?.content

        return FhirCarePlan(
            id = id,
            patientId = patientId,
            planId = planId,
            title = title,
            description = description,
            status = status,
            periodStart = periodStart,
            periodEnd = periodEnd
        )
    }

    // ==================== Utility ====================

    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any>.toJsonObject(): JsonObject {
        val elements = this.mapValues { (_, value) ->
            when (value) {
                is String -> JsonPrimitive(value)
                is Number -> JsonPrimitive(value)
                is Boolean -> JsonPrimitive(value)
                is List<*> -> JsonArray((value as List<Any>).map { it.toJsonElement() })
                is Map<*, *> -> (value as Map<String, Any>).toJsonObject()
                else -> JsonPrimitive(value.toString())
            }
        }
        return JsonObject(elements)
    }

    private fun Any.toJsonElement(): JsonElement {
        return when (this) {
            is String -> JsonPrimitive(this)
            is Number -> JsonPrimitive(this)
            is Boolean -> JsonPrimitive(this)
            is List<*> -> JsonArray(this.filterNotNull().map { it.toJsonElement() })
            is Map<*, *> -> {
                @Suppress("UNCHECKED_CAST")
                (this as Map<String, Any>).toJsonObject()
            }
            else -> JsonPrimitive(this.toString())
        }
    }
}

/**
 * Configuration for FHIR client.
 */
data class FhirClientConfig(
    val baseUrl: String,
    val healthLakeDatastoreId: String
)

/**
 * Exception for FHIR client errors.
 */
class FhirClientException(message: String, cause: Throwable? = null) : Exception(message, cause)
