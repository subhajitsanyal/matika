//
//  LocalFHIRModels.swift
//  CareLog
//
//  SwiftData models for local FHIR resource storage
//

import Foundation
import SwiftData

// MARK: - Sync Status

/// Sync status for local FHIR resources.
enum SyncStatus: String, Codable {
    /// Resource created locally, not yet synced to server.
    case pending
    /// Resource successfully synced to server.
    case synced
    /// Sync failed, will retry on next sync cycle.
    case failed
    /// Resource modified locally after sync, needs re-sync.
    case modified
}

// MARK: - Local Observation

/// SwiftData model for locally stored FHIR Observation.
@Model
final class LocalObservation {
    @Attribute(.unique) var localId: String
    var serverId: String?

    var patientId: String
    var typeRawValue: String  // ObservationType.rawValue
    var effectiveDateTime: Date

    var value: Double?
    var unit: String?

    // Blood pressure components
    var systolicValue: Double?
    var diastolicValue: Double?

    var interpretationRawValue: String?  // InterpretationCode.rawValue
    var performerId: String?
    var performerTypeRawValue: String  // PerformerType.rawValue
    var note: String?

    // Context
    var isFasting: Bool
    var isPostMeal: Bool

    var statusRawValue: String  // ObservationStatus.rawValue
    var syncStatusRawValue: String  // SyncStatus.rawValue
    var syncError: String?
    var syncAttempts: Int
    var lastSyncAttempt: Date?

    var createdAt: Date
    var updatedAt: Date

    init(
        localId: String = UUID().uuidString,
        serverId: String? = nil,
        patientId: String,
        type: ObservationType,
        effectiveDateTime: Date,
        value: Double? = nil,
        unit: String? = nil,
        systolicValue: Double? = nil,
        diastolicValue: Double? = nil,
        interpretation: InterpretationCode? = nil,
        performerId: String? = nil,
        performerType: PerformerType = .relatedPerson,
        note: String? = nil,
        isFasting: Bool = false,
        isPostMeal: Bool = false,
        status: ObservationStatus = .final,
        syncStatus: SyncStatus = .pending
    ) {
        self.localId = localId
        self.serverId = serverId
        self.patientId = patientId
        self.typeRawValue = type.rawValue
        self.effectiveDateTime = effectiveDateTime
        self.value = value
        self.unit = unit
        self.systolicValue = systolicValue
        self.diastolicValue = diastolicValue
        self.interpretationRawValue = interpretation?.rawValue
        self.performerId = performerId
        self.performerTypeRawValue = performerType.rawValue
        self.note = note
        self.isFasting = isFasting
        self.isPostMeal = isPostMeal
        self.statusRawValue = status.rawValue
        self.syncStatusRawValue = syncStatus.rawValue
        self.syncError = nil
        self.syncAttempts = 0
        self.lastSyncAttempt = nil
        self.createdAt = Date()
        self.updatedAt = Date()
    }

    // Computed properties for type safety
    var type: ObservationType {
        ObservationType(rawValue: typeRawValue) ?? .bodyWeight
    }

    var interpretation: InterpretationCode? {
        interpretationRawValue.flatMap { InterpretationCode(rawValue: $0) }
    }

    var performerType: PerformerType {
        PerformerType(rawValue: performerTypeRawValue) ?? .relatedPerson
    }

    var status: ObservationStatus {
        ObservationStatus(rawValue: statusRawValue) ?? .final
    }

    var syncStatus: SyncStatus {
        get { SyncStatus(rawValue: syncStatusRawValue) ?? .pending }
        set { syncStatusRawValue = newValue.rawValue }
    }

    /// Convert to FHIR JSON representation.
    func toFHIRJSON() throws -> [String: Any] {
        var resource: [String: Any] = [
            "resourceType": "Observation",
            "status": status.rawValue,
            "code": [
                "coding": [[
                    "system": "http://loinc.org",
                    "code": type.loincCode
                ]]
            ],
            "subject": [
                "reference": "Patient/\(patientId)"
            ],
            "effectiveDateTime": ISO8601DateFormatter().string(from: effectiveDateTime)
        ]

        if let id = serverId {
            resource["id"] = id
        }

        if let value = value, let unit = unit {
            resource["valueQuantity"] = [
                "value": value,
                "unit": unit,
                "system": "http://unitsofmeasure.org"
            ]
        }

        // Blood pressure components
        if type == .bloodPressure, let sys = systolicValue, let dia = diastolicValue {
            resource["component"] = [
                [
                    "code": ["coding": [["system": "http://loinc.org", "code": "8480-6"]]],
                    "valueQuantity": ["value": sys, "unit": "mmHg"]
                ],
                [
                    "code": ["coding": [["system": "http://loinc.org", "code": "8462-4"]]],
                    "valueQuantity": ["value": dia, "unit": "mmHg"]
                ]
            ]
        }

        if let performerId = performerId {
            resource["performer"] = [["reference": "RelatedPerson/\(performerId)"]]
        }

        if let note = note {
            resource["note"] = [["text": note]]
        }

        return resource
    }
}

// MARK: - Local Document Reference

/// SwiftData model for locally stored FHIR DocumentReference.
@Model
final class LocalDocumentReference {
    @Attribute(.unique) var localId: String
    var serverId: String?

    var patientId: String
    var documentId: String  // UUID for S3 reference
    var typeRawValue: String  // DocumentType.rawValue
    var title: String
    var documentDescription: String?

    var localFilePath: String  // Local file path before upload
    var contentUrl: String?  // S3 URL after upload
    var contentType: String  // MIME type
    var size: Int64?
    var date: Date

    var authorId: String?
    var authorName: String?
    var authorTypeRawValue: String  // PerformerType.rawValue
    var documentStatusRawValue: String  // DocumentStatus.rawValue

    var fileUploadStatusRawValue: String  // SyncStatus - S3 upload
    var fhirSyncStatusRawValue: String  // SyncStatus - FHIR resource
    var syncError: String?
    var syncAttempts: Int

    var createdAt: Date
    var updatedAt: Date

    init(
        localId: String = UUID().uuidString,
        serverId: String? = nil,
        patientId: String,
        documentId: String,
        type: DocumentType,
        title: String,
        description: String? = nil,
        localFilePath: String,
        contentUrl: String? = nil,
        contentType: String,
        size: Int64? = nil,
        date: Date,
        authorId: String? = nil,
        authorName: String? = nil,
        authorType: PerformerType = .relatedPerson,
        documentStatus: DocumentStatus = .current,
        fileUploadStatus: SyncStatus = .pending,
        fhirSyncStatus: SyncStatus = .pending
    ) {
        self.localId = localId
        self.serverId = serverId
        self.patientId = patientId
        self.documentId = documentId
        self.typeRawValue = type.rawValue
        self.title = title
        self.documentDescription = description
        self.localFilePath = localFilePath
        self.contentUrl = contentUrl
        self.contentType = contentType
        self.size = size
        self.date = date
        self.authorId = authorId
        self.authorName = authorName
        self.authorTypeRawValue = authorType.rawValue
        self.documentStatusRawValue = documentStatus.rawValue
        self.fileUploadStatusRawValue = fileUploadStatus.rawValue
        self.fhirSyncStatusRawValue = fhirSyncStatus.rawValue
        self.syncError = nil
        self.syncAttempts = 0
        self.createdAt = Date()
        self.updatedAt = Date()
    }

    // Computed properties
    var type: DocumentType {
        DocumentType(rawValue: typeRawValue) ?? .other
    }

    var authorType: PerformerType {
        PerformerType(rawValue: authorTypeRawValue) ?? .relatedPerson
    }

    var documentStatus: DocumentStatus {
        DocumentStatus(rawValue: documentStatusRawValue) ?? .current
    }

    var fileUploadStatus: SyncStatus {
        get { SyncStatus(rawValue: fileUploadStatusRawValue) ?? .pending }
        set { fileUploadStatusRawValue = newValue.rawValue }
    }

    var fhirSyncStatus: SyncStatus {
        get { SyncStatus(rawValue: fhirSyncStatusRawValue) ?? .pending }
        set { fhirSyncStatusRawValue = newValue.rawValue }
    }

    /// Convert to FHIR JSON representation.
    func toFHIRJSON() throws -> [String: Any] {
        var resource: [String: Any] = [
            "resourceType": "DocumentReference",
            "status": documentStatus.rawValue,
            "type": [
                "coding": [[
                    "system": "http://loinc.org",
                    "code": type.loincCode
                ]]
            ],
            "subject": [
                "reference": "Patient/\(patientId)"
            ],
            "date": ISO8601DateFormatter().string(from: date),
            "content": [[
                "attachment": [
                    "contentType": contentType,
                    "url": contentUrl ?? localFilePath,
                    "title": title
                ]
            ]]
        ]

        if let id = serverId {
            resource["id"] = id
        }

        if let description = documentDescription {
            resource["description"] = description
        }

        if let authorName = authorName {
            resource["author"] = [["display": authorName]]
        }

        return resource
    }
}
