package com.carelog.fhir.client

import com.carelog.fhir.models.*

/**
 * FHIR client interface for CareLog.
 *
 * Provides CRUD operations for FHIR R4 resources used in the app.
 * Uses LOINC codes for vital sign observations.
 */
interface FhirClient {

    // Patient Operations
    suspend fun createPatient(patient: FhirPatient): String
    suspend fun getPatient(patientId: String): FhirPatient?
    suspend fun updatePatient(patient: FhirPatient): Boolean
    suspend fun deletePatient(patientId: String): Boolean

    // Observation Operations
    suspend fun createObservation(observation: FhirObservation): String
    suspend fun getObservation(observationId: String): FhirObservation?
    suspend fun getObservationsForPatient(
        patientId: String,
        type: ObservationType? = null,
        startDate: String? = null,
        endDate: String? = null,
        limit: Int = 100
    ): List<FhirObservation>
    suspend fun deleteObservation(observationId: String): Boolean

    // DocumentReference Operations
    suspend fun createDocumentReference(document: FhirDocumentReference): String
    suspend fun getDocumentReference(documentId: String): FhirDocumentReference?
    suspend fun getDocumentsForPatient(
        patientId: String,
        type: DocumentType? = null,
        limit: Int = 50
    ): List<FhirDocumentReference>
    suspend fun deleteDocumentReference(documentId: String): Boolean

    // CarePlan Operations
    suspend fun createCarePlan(carePlan: FhirCarePlan): String
    suspend fun getCarePlan(carePlanId: String): FhirCarePlan?
    suspend fun getCarePlansForPatient(patientId: String): List<FhirCarePlan>
    suspend fun updateCarePlan(carePlan: FhirCarePlan): Boolean
    suspend fun deleteCarePlan(carePlanId: String): Boolean
}

/**
 * Observation types supported by CareLog with LOINC codes.
 */
enum class ObservationType(val loincCode: String, val displayName: String, val unit: String) {
    BODY_WEIGHT("29463-7", "Body weight", "kg"),
    BLOOD_GLUCOSE("2339-0", "Glucose [Mass/volume] in Blood", "mg/dL"),
    BODY_TEMPERATURE("8310-5", "Body temperature", "°F"),
    BLOOD_PRESSURE("85354-9", "Blood pressure panel", "mmHg"),
    SYSTOLIC_BP("8480-6", "Systolic blood pressure", "mmHg"),
    DIASTOLIC_BP("8462-4", "Diastolic blood pressure", "mmHg"),
    HEART_RATE("8867-4", "Heart rate", "/min"),
    OXYGEN_SATURATION("2708-6", "Oxygen saturation in Arterial blood", "%")
}

/**
 * Document types supported by CareLog.
 */
enum class DocumentType(val code: String, val loincCode: String, val displayName: String) {
    PRESCRIPTION("prescription", "57833-6", "Prescription for medication"),
    LAB_REPORT("lab_report", "11502-2", "Laboratory report"),
    IMAGING("imaging", "18748-4", "Diagnostic imaging report"),
    DISCHARGE_SUMMARY("discharge_summary", "18842-5", "Discharge summary"),
    OTHER("other", "34133-9", "Summary of episode note")
}

/**
 * Observation interpretation codes.
 */
enum class InterpretationCode(val code: String, val display: String) {
    LOW("L", "Low"),
    NORMAL("N", "Normal"),
    HIGH("H", "High"),
    CRITICALLY_LOW("LL", "Critically Low"),
    CRITICALLY_HIGH("HH", "Critically High")
}
