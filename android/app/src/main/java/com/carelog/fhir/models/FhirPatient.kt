package com.carelog.fhir.models

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * CareLog representation of a FHIR Patient resource.
 */
@Serializable
data class FhirPatient(
    val id: String? = null,
    val patientId: String,  // CL-XXXXXX format
    val name: String,
    val birthDate: String? = null,  // YYYY-MM-DD
    val gender: PatientGender = PatientGender.UNKNOWN,
    val bloodType: String? = null,
    val emergencyContact: EmergencyContact? = null,
    val active: Boolean = true,
    val meta: ResourceMeta? = null
)

/**
 * Patient gender as defined in FHIR.
 */
@Serializable
enum class PatientGender(val fhirCode: String) {
    MALE("male"),
    FEMALE("female"),
    OTHER("other"),
    UNKNOWN("unknown");

    companion object {
        fun fromString(value: String?): PatientGender {
            return entries.find { it.fhirCode.equals(value, ignoreCase = true) } ?: UNKNOWN
        }
    }
}

/**
 * Emergency contact information.
 */
@Serializable
data class EmergencyContact(
    val name: String,
    val phone: String? = null,
    val relationship: String = "C"  // Emergency Contact code
)

/**
 * Resource metadata.
 */
@Serializable
data class ResourceMeta(
    val versionId: String? = null,
    val lastUpdated: String? = null
)

/**
 * Convert to FHIR JSON format.
 */
fun FhirPatient.toFhirJson(): Map<String, Any> {
    val resource = mutableMapOf<String, Any>(
        "resourceType" to "Patient",
        "identifier" to listOf(
            mapOf(
                "system" to "https://carelog.com/patient-id",
                "value" to patientId
            )
        ),
        "active" to active,
        "name" to listOf(
            mapOf(
                "use" to "official",
                "text" to name
            )
        ),
        "gender" to gender.fhirCode
    )

    id?.let { resource["id"] = it }
    birthDate?.let { resource["birthDate"] = it }

    bloodType?.let {
        resource["extension"] = listOf(
            mapOf(
                "url" to "https://carelog.com/fhir/StructureDefinition/blood-type",
                "valueString" to it
            )
        )
    }

    emergencyContact?.let { contact ->
        resource["contact"] = listOf(
            mapOf(
                "relationship" to listOf(
                    mapOf(
                        "coding" to listOf(
                            mapOf(
                                "system" to "http://terminology.hl7.org/CodeSystem/v2-0131",
                                "code" to contact.relationship,
                                "display" to "Emergency Contact"
                            )
                        )
                    )
                ),
                "name" to mapOf("text" to contact.name),
                "telecom" to listOfNotNull(
                    contact.phone?.let {
                        mapOf(
                            "system" to "phone",
                            "value" to it,
                            "use" to "mobile"
                        )
                    }
                )
            )
        )
    }

    return resource
}
