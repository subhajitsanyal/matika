package com.carelog.fhir.models

import com.carelog.fhir.client.ObservationType
import kotlinx.serialization.Serializable

/**
 * CareLog representation of a FHIR CarePlan resource.
 *
 * Used for care reminders and medication schedules.
 */
@Serializable
data class FhirCarePlan(
    val id: String? = null,
    val patientId: String,
    val planId: String,  // UUID
    val title: String,
    val description: String? = null,
    val status: CarePlanStatus = CarePlanStatus.ACTIVE,
    val intent: CarePlanIntent = CarePlanIntent.PLAN,
    val periodStart: String? = null,  // ISO 8601 date
    val periodEnd: String? = null,
    val created: String? = null,
    val authorId: String? = null,
    val authorType: PerformerType = PerformerType.RELATED_PERSON,
    val activities: List<CarePlanActivity> = emptyList(),
    val meta: ResourceMeta? = null
)

/**
 * Care plan status as defined in FHIR.
 */
@Serializable
enum class CarePlanStatus(val fhirCode: String) {
    DRAFT("draft"),
    ACTIVE("active"),
    ON_HOLD("on-hold"),
    REVOKED("revoked"),
    COMPLETED("completed"),
    UNKNOWN("unknown")
}

/**
 * Care plan intent as defined in FHIR.
 */
@Serializable
enum class CarePlanIntent(val fhirCode: String) {
    PROPOSAL("proposal"),
    PLAN("plan"),
    ORDER("order"),
    OPTION("option")
}

/**
 * Care plan activity (scheduled task).
 */
@Serializable
data class CarePlanActivity(
    val id: String? = null,
    val kind: ActivityKind,
    val code: ActivityCode,
    val description: String,
    val status: ActivityStatus = ActivityStatus.SCHEDULED,
    val schedule: ActivitySchedule? = null
)

/**
 * Type of activity.
 */
@Serializable
enum class ActivityKind(val fhirCode: String) {
    SERVICE_REQUEST("ServiceRequest"),  // Vital measurement
    MEDICATION_REQUEST("MedicationRequest")  // Medication reminder
}

/**
 * Activity code (observation type or medication).
 */
@Serializable
data class ActivityCode(
    val system: String,
    val code: String,
    val display: String
) {
    companion object {
        fun fromObservationType(type: ObservationType) = ActivityCode(
            system = "http://loinc.org",
            code = type.loincCode,
            display = type.displayName
        )

        fun medication(rxNormCode: String, name: String) = ActivityCode(
            system = "http://www.nlm.nih.gov/research/umls/rxnorm",
            code = rxNormCode,
            display = name
        )
    }
}

/**
 * Activity status as defined in FHIR.
 */
@Serializable
enum class ActivityStatus(val fhirCode: String) {
    NOT_STARTED("not-started"),
    SCHEDULED("scheduled"),
    IN_PROGRESS("in-progress"),
    ON_HOLD("on-hold"),
    COMPLETED("completed"),
    CANCELLED("cancelled"),
    STOPPED("stopped"),
    UNKNOWN("unknown")
}

/**
 * Activity schedule (when to perform).
 */
@Serializable
data class ActivitySchedule(
    val frequency: Int = 1,  // Times per period
    val period: Int = 1,
    val periodUnit: PeriodUnit = PeriodUnit.DAY,
    val timeOfDay: List<String> = emptyList(),  // HH:mm:ss format
    val `when`: List<TimingEvent> = emptyList()
)

/**
 * Period unit for scheduling.
 */
@Serializable
enum class PeriodUnit(val fhirCode: String) {
    SECOND("s"),
    MINUTE("min"),
    HOUR("h"),
    DAY("d"),
    WEEK("wk"),
    MONTH("mo"),
    YEAR("a")
}

/**
 * Timing events (when in relation to meals, etc.).
 */
@Serializable
enum class TimingEvent(val fhirCode: String) {
    MORNING("MORN"),
    AFTERNOON("AFT"),
    EVENING("EVE"),
    NIGHT("NIGHT"),
    BEFORE_MEAL("AC"),
    AFTER_MEAL("PC"),
    BEFORE_BREAKFAST("ACM"),
    AFTER_BREAKFAST("PCM"),
    BEFORE_LUNCH("ACD"),
    AFTER_LUNCH("PCD"),
    BEFORE_DINNER("ACV"),
    AFTER_DINNER("PCV")
}

/**
 * Convert to FHIR JSON format.
 */
fun FhirCarePlan.toFhirJson(): Map<String, Any> {
    val resource = mutableMapOf<String, Any>(
        "resourceType" to "CarePlan",
        "identifier" to listOf(
            mapOf(
                "system" to "https://carelog.com/careplan-id",
                "value" to planId
            )
        ),
        "status" to status.fhirCode,
        "intent" to intent.fhirCode,
        "category" to listOf(
            mapOf(
                "coding" to listOf(
                    mapOf(
                        "system" to "http://hl7.org/fhir/us/core/CodeSystem/careplan-category",
                        "code" to "assess-plan",
                        "display" to "Assessment and Plan of Treatment"
                    )
                )
            )
        ),
        "title" to title,
        "subject" to mapOf("reference" to "Patient/$patientId")
    )

    id?.let { resource["id"] = it }
    description?.let { resource["description"] = it }
    created?.let { resource["created"] = it }

    if (periodStart != null || periodEnd != null) {
        resource["period"] = buildMap {
            periodStart?.let { put("start", it) }
            periodEnd?.let { put("end", it) }
        }
    }

    authorId?.let {
        resource["author"] = mapOf("reference" to "${authorType.fhirReference}/$it")
    }

    if (activities.isNotEmpty()) {
        resource["activity"] = activities.map { activity ->
            mapOf(
                "detail" to buildMap {
                    put("kind", activity.kind.fhirCode)
                    put("code", mapOf(
                        "coding" to listOf(
                            mapOf(
                                "system" to activity.code.system,
                                "code" to activity.code.code,
                                "display" to activity.code.display
                            )
                        )
                    ))
                    put("status", activity.status.fhirCode)
                    put("description", activity.description)

                    activity.schedule?.let { schedule ->
                        put("scheduledTiming", mapOf(
                            "repeat" to buildMap {
                                put("frequency", schedule.frequency)
                                put("period", schedule.period)
                                put("periodUnit", schedule.periodUnit.fhirCode)
                                if (schedule.timeOfDay.isNotEmpty()) {
                                    put("timeOfDay", schedule.timeOfDay)
                                }
                                if (schedule.`when`.isNotEmpty()) {
                                    put("when", schedule.`when`.map { it.fhirCode })
                                }
                            }
                        ))
                    }
                }
            )
        }
    }

    return resource
}
