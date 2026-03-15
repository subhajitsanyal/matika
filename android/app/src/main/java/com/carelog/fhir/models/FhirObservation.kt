package com.carelog.fhir.models

import com.carelog.fhir.client.InterpretationCode
import com.carelog.fhir.client.ObservationType
import kotlinx.serialization.Serializable

/**
 * CareLog representation of a FHIR Observation resource.
 *
 * Used for recording vital signs with proper LOINC coding.
 */
@Serializable
data class FhirObservation(
    val id: String? = null,
    val patientId: String,
    val type: ObservationType,
    val effectiveDateTime: String,  // ISO 8601
    val value: Double? = null,
    val unit: String? = null,
    val components: List<ObservationComponent>? = null,  // For BP with systolic/diastolic
    val interpretation: InterpretationCode? = null,
    val performerId: String? = null,
    val performerType: PerformerType = PerformerType.RELATED_PERSON,
    val note: String? = null,
    val context: MeasurementContext? = null,
    val status: ObservationStatus = ObservationStatus.FINAL,
    val meta: ResourceMeta? = null
)

/**
 * Component for multi-value observations (e.g., blood pressure).
 */
@Serializable
data class ObservationComponent(
    val type: ObservationType,
    val value: Double,
    val unit: String
)

/**
 * Type of performer who recorded the observation.
 */
@Serializable
enum class PerformerType(val fhirReference: String) {
    PRACTITIONER("Practitioner"),
    RELATED_PERSON("RelatedPerson"),
    PATIENT("Patient")
}

/**
 * Observation status as defined in FHIR.
 */
@Serializable
enum class ObservationStatus(val fhirCode: String) {
    REGISTERED("registered"),
    PRELIMINARY("preliminary"),
    FINAL("final"),
    AMENDED("amended"),
    CANCELLED("cancelled")
}

/**
 * Context for measurements (e.g., fasting glucose).
 */
@Serializable
data class MeasurementContext(
    val fasting: Boolean = false,
    val postMeal: Boolean = false,
    val beforeMedication: Boolean = false,
    val afterExercise: Boolean = false
)

/**
 * Convert to FHIR JSON format.
 */
fun FhirObservation.toFhirJson(): Map<String, Any> {
    val resource = mutableMapOf<String, Any>(
        "resourceType" to "Observation",
        "status" to status.fhirCode,
        "category" to listOf(
            mapOf(
                "coding" to listOf(
                    mapOf(
                        "system" to "http://terminology.hl7.org/CodeSystem/observation-category",
                        "code" to "vital-signs",
                        "display" to "Vital Signs"
                    )
                )
            )
        ),
        "code" to mapOf(
            "coding" to listOf(
                mapOf(
                    "system" to "http://loinc.org",
                    "code" to type.loincCode,
                    "display" to type.displayName
                )
            )
        ),
        "subject" to mapOf("reference" to "Patient/$patientId"),
        "effectiveDateTime" to effectiveDateTime
    )

    id?.let { resource["id"] = it }

    // Handle single value or components
    if (type == ObservationType.BLOOD_PRESSURE && components != null) {
        resource["component"] = components.map { component ->
            mapOf(
                "code" to mapOf(
                    "coding" to listOf(
                        mapOf(
                            "system" to "http://loinc.org",
                            "code" to component.type.loincCode,
                            "display" to component.type.displayName
                        )
                    )
                ),
                "valueQuantity" to mapOf(
                    "value" to component.value,
                    "unit" to component.unit,
                    "system" to "http://unitsofmeasure.org",
                    "code" to getUcumCode(component.unit)
                )
            )
        }
    } else if (value != null) {
        resource["valueQuantity"] = mapOf(
            "value" to value,
            "unit" to (unit ?: type.unit),
            "system" to "http://unitsofmeasure.org",
            "code" to getUcumCode(unit ?: type.unit)
        )
    }

    interpretation?.let {
        resource["interpretation"] = listOf(
            mapOf(
                "coding" to listOf(
                    mapOf(
                        "system" to "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                        "code" to it.code,
                        "display" to it.display
                    )
                )
            )
        )
    }

    performerId?.let {
        resource["performer"] = listOf(
            mapOf("reference" to "${performerType.fhirReference}/$it")
        )
    }

    note?.let {
        resource["note"] = listOf(mapOf("text" to it))
    }

    return resource
}

/**
 * Convert unit string to UCUM code.
 */
private fun getUcumCode(unit: String): String {
    return when (unit.lowercase()) {
        "kg" -> "kg"
        "lb" -> "[lb_av]"
        "mg/dl" -> "mg/dL"
        "mmhg" -> "mm[Hg]"
        "/min", "beats/minute", "bpm" -> "/min"
        "%" -> "%"
        "°f" -> "[degF]"
        "°c" -> "Cel"
        else -> unit
    }
}
