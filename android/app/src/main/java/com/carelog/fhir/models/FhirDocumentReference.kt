package com.carelog.fhir.models

import com.carelog.fhir.client.DocumentType
import kotlinx.serialization.Serializable

/**
 * CareLog representation of a FHIR DocumentReference resource.
 *
 * Used for linking uploaded documents (prescriptions, reports) to FHIR.
 */
@Serializable
data class FhirDocumentReference(
    val id: String? = null,
    val patientId: String,
    val documentId: String,  // UUID
    val type: DocumentType,
    val title: String,
    val description: String? = null,
    val contentUrl: String,  // S3 URL or presigned URL
    val contentType: String,  // MIME type
    val size: Long? = null,
    val date: String,  // ISO 8601 datetime
    val authorId: String? = null,
    val authorName: String? = null,
    val authorType: PerformerType = PerformerType.RELATED_PERSON,
    val status: DocumentStatus = DocumentStatus.CURRENT,
    val periodStart: String? = null,
    val periodEnd: String? = null,
    val meta: ResourceMeta? = null
)

/**
 * Document status as defined in FHIR.
 */
@Serializable
enum class DocumentStatus(val fhirCode: String) {
    CURRENT("current"),
    SUPERSEDED("superseded"),
    ENTERED_IN_ERROR("entered-in-error")
}

/**
 * Convert to FHIR JSON format.
 */
fun FhirDocumentReference.toFhirJson(): Map<String, Any> {
    val resource = mutableMapOf<String, Any>(
        "resourceType" to "DocumentReference",
        "identifier" to listOf(
            mapOf(
                "system" to "https://carelog.com/document-id",
                "value" to documentId
            )
        ),
        "status" to status.fhirCode,
        "type" to mapOf(
            "coding" to listOf(
                mapOf(
                    "system" to "https://carelog.com/fhir/CodeSystem/document-type",
                    "code" to type.code,
                    "display" to type.displayName
                ),
                mapOf(
                    "system" to "http://loinc.org",
                    "code" to type.loincCode,
                    "display" to type.displayName
                )
            )
        ),
        "category" to listOf(
            mapOf(
                "coding" to listOf(
                    mapOf(
                        "system" to "http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category",
                        "code" to "clinical-note",
                        "display" to "Clinical Note"
                    )
                )
            )
        ),
        "subject" to mapOf("reference" to "Patient/$patientId"),
        "date" to date,
        "content" to listOf(
            mapOf(
                "attachment" to buildMap {
                    put("contentType", contentType)
                    put("url", contentUrl)
                    put("title", title)
                    put("creation", date)
                    size?.let { put("size", it) }
                }
            )
        )
    )

    id?.let { resource["id"] = it }
    description?.let { resource["description"] = it }

    if (authorId != null || authorName != null) {
        resource["author"] = listOf(
            buildMap {
                authorId?.let { put("reference", "${authorType.fhirReference}/$it") }
                authorName?.let { put("display", it) }
            }
        )
    }

    if (periodStart != null || periodEnd != null) {
        resource["context"] = mapOf(
            "period" to buildMap {
                periodStart?.let { put("start", it) }
                periodEnd?.let { put("end", it) }
            }
        )
    }

    return resource
}
