//
//  LocalFHIRRepository.swift
//  CareLog
//
//  Repository for local FHIR resource storage using SwiftData
//

import Foundation
import SwiftData

/// Repository for local FHIR resource storage.
///
/// Provides offline-first CRUD operations with sync status tracking.
/// All data is stored locally first, then synced to the server
/// when connectivity is available.
@MainActor
class LocalFHIRRepository: ObservableObject {
    private let modelContainer: ModelContainer
    private let modelContext: ModelContext

    init() throws {
        let schema = Schema([
            LocalObservation.self,
            LocalDocumentReference.self
        ])

        let modelConfiguration = ModelConfiguration(
            schema: schema,
            isStoredInMemoryOnly: false,
            allowsSave: true
        )

        modelContainer = try ModelContainer(for: schema, configurations: [modelConfiguration])
        modelContext = modelContainer.mainContext
    }

    // MARK: - Observation Operations

    /// Save an observation locally.
    func saveObservation(_ observation: FHIRObservation) throws -> String {
        let localId = UUID().uuidString

        let localObservation = LocalObservation(
            localId: localId,
            serverId: observation.id,
            patientId: observation.patientId,
            type: observation.type,
            effectiveDateTime: observation.effectiveDateTime,
            value: observation.value,
            unit: observation.unit,
            systolicValue: observation.components?.first(where: { $0.type == .systolicBP })?.value,
            diastolicValue: observation.components?.first(where: { $0.type == .diastolicBP })?.value,
            interpretation: observation.interpretation,
            performerId: observation.performerId,
            performerType: observation.performerType,
            note: observation.note,
            isFasting: observation.context?.fasting ?? false,
            isPostMeal: observation.context?.postMeal ?? false,
            status: observation.status,
            syncStatus: observation.id != nil ? .synced : .pending
        )

        modelContext.insert(localObservation)
        try modelContext.save()

        return localId
    }

    /// Get an observation by local ID.
    func getObservation(localId: String) throws -> FHIRObservation? {
        let descriptor = FetchDescriptor<LocalObservation>(
            predicate: #Predicate { $0.localId == localId }
        )
        guard let local = try modelContext.fetch(descriptor).first else {
            return nil
        }
        return local.toFHIRObservation()
    }

    /// Get all observations for a patient.
    func getObservationsForPatient(_ patientId: String) throws -> [FHIRObservation] {
        let descriptor = FetchDescriptor<LocalObservation>(
            predicate: #Predicate { $0.patientId == patientId },
            sortBy: [SortDescriptor(\.effectiveDateTime, order: .reverse)]
        )
        return try modelContext.fetch(descriptor).map { $0.toFHIRObservation() }
    }

    /// Get observations by type for a patient.
    func getObservationsByType(_ patientId: String, type: ObservationType) throws -> [FHIRObservation] {
        let typeRawValue = type.rawValue
        let descriptor = FetchDescriptor<LocalObservation>(
            predicate: #Predicate {
                $0.patientId == patientId && $0.typeRawValue == typeRawValue
            },
            sortBy: [SortDescriptor(\.effectiveDateTime, order: .reverse)]
        )
        return try modelContext.fetch(descriptor).map { $0.toFHIRObservation() }
    }

    /// Get the latest observation of a type for a patient.
    func getLatestObservation(_ patientId: String, type: ObservationType) throws -> FHIRObservation? {
        let typeRawValue = type.rawValue
        var descriptor = FetchDescriptor<LocalObservation>(
            predicate: #Predicate {
                $0.patientId == patientId && $0.typeRawValue == typeRawValue
            },
            sortBy: [SortDescriptor(\.effectiveDateTime, order: .reverse)]
        )
        descriptor.fetchLimit = 1
        return try modelContext.fetch(descriptor).first?.toFHIRObservation()
    }

    /// Get observations pending sync.
    func getPendingSyncObservations(limit: Int = 50) throws -> [LocalObservation] {
        let pendingStatus = SyncStatus.pending.rawValue
        var descriptor = FetchDescriptor<LocalObservation>(
            predicate: #Predicate { $0.syncStatusRawValue == pendingStatus },
            sortBy: [SortDescriptor(\.createdAt)]
        )
        descriptor.fetchLimit = limit
        return try modelContext.fetch(descriptor)
    }

    /// Mark an observation as synced.
    func markObservationSynced(localId: String, serverId: String) throws {
        let descriptor = FetchDescriptor<LocalObservation>(
            predicate: #Predicate { $0.localId == localId }
        )
        guard let observation = try modelContext.fetch(descriptor).first else { return }

        observation.serverId = serverId
        observation.syncStatus = .synced
        observation.syncError = nil
        observation.updatedAt = Date()

        try modelContext.save()
    }

    /// Mark an observation sync as failed.
    func markObservationSyncFailed(localId: String, error: String) throws {
        let descriptor = FetchDescriptor<LocalObservation>(
            predicate: #Predicate { $0.localId == localId }
        )
        guard let observation = try modelContext.fetch(descriptor).first else { return }

        observation.syncStatus = .failed
        observation.syncError = error
        observation.syncAttempts += 1
        observation.lastSyncAttempt = Date()
        observation.updatedAt = Date()

        try modelContext.save()
    }

    /// Get count of observations pending sync.
    func getPendingObservationCount() throws -> Int {
        let pendingStatus = SyncStatus.pending.rawValue
        let failedStatus = SyncStatus.failed.rawValue
        let descriptor = FetchDescriptor<LocalObservation>(
            predicate: #Predicate {
                $0.syncStatusRawValue == pendingStatus || $0.syncStatusRawValue == failedStatus
            }
        )
        return try modelContext.fetchCount(descriptor)
    }

    /// Delete an observation.
    func deleteObservation(localId: String) throws {
        let descriptor = FetchDescriptor<LocalObservation>(
            predicate: #Predicate { $0.localId == localId }
        )
        if let observation = try modelContext.fetch(descriptor).first {
            modelContext.delete(observation)
            try modelContext.save()
        }
    }

    // MARK: - DocumentReference Operations

    /// Save a document reference locally.
    func saveDocumentReference(_ document: FHIRDocumentReference, localFilePath: String) throws -> String {
        let localId = UUID().uuidString

        let localDocument = LocalDocumentReference(
            localId: localId,
            serverId: document.id,
            patientId: document.patientId,
            documentId: document.documentId,
            type: document.type,
            title: document.title,
            description: document.description,
            localFilePath: localFilePath,
            contentUrl: document.contentUrl,
            contentType: document.contentType,
            size: document.size,
            date: document.date,
            authorId: document.authorId,
            authorName: document.authorName,
            authorType: document.authorType,
            documentStatus: document.status,
            fileUploadStatus: document.contentUrl != nil ? .synced : .pending,
            fhirSyncStatus: document.id != nil ? .synced : .pending
        )

        modelContext.insert(localDocument)
        try modelContext.save()

        return localId
    }

    /// Get documents for a patient.
    func getDocumentsForPatient(_ patientId: String) throws -> [FHIRDocumentReference] {
        let descriptor = FetchDescriptor<LocalDocumentReference>(
            predicate: #Predicate { $0.patientId == patientId },
            sortBy: [SortDescriptor(\.date, order: .reverse)]
        )
        return try modelContext.fetch(descriptor).map { $0.toFHIRDocumentReference() }
    }

    /// Get documents pending file upload.
    func getPendingFileUploads(limit: Int = 10) throws -> [LocalDocumentReference] {
        let pendingStatus = SyncStatus.pending.rawValue
        var descriptor = FetchDescriptor<LocalDocumentReference>(
            predicate: #Predicate { $0.fileUploadStatusRawValue == pendingStatus },
            sortBy: [SortDescriptor(\.createdAt)]
        )
        descriptor.fetchLimit = limit
        return try modelContext.fetch(descriptor)
    }

    /// Mark a document's file as uploaded.
    func markFileUploaded(localId: String, contentUrl: String) throws {
        let descriptor = FetchDescriptor<LocalDocumentReference>(
            predicate: #Predicate { $0.localId == localId }
        )
        guard let document = try modelContext.fetch(descriptor).first else { return }

        document.contentUrl = contentUrl
        document.fileUploadStatus = .synced
        document.syncError = nil
        document.updatedAt = Date()

        try modelContext.save()
    }

    /// Mark a document's file upload as failed.
    func markFileUploadFailed(localId: String, error: String) throws {
        let descriptor = FetchDescriptor<LocalDocumentReference>(
            predicate: #Predicate { $0.localId == localId }
        )
        guard let document = try modelContext.fetch(descriptor).first else { return }

        document.fileUploadStatus = .failed
        document.syncError = error
        document.syncAttempts += 1
        document.updatedAt = Date()

        try modelContext.save()
    }

    /// Get documents pending FHIR sync.
    func getPendingFHIRSync(limit: Int = 50) throws -> [LocalDocumentReference] {
        let syncedUpload = SyncStatus.synced.rawValue
        let pendingFhir = SyncStatus.pending.rawValue
        var descriptor = FetchDescriptor<LocalDocumentReference>(
            predicate: #Predicate {
                $0.fileUploadStatusRawValue == syncedUpload &&
                $0.fhirSyncStatusRawValue == pendingFhir
            },
            sortBy: [SortDescriptor(\.createdAt)]
        )
        descriptor.fetchLimit = limit
        return try modelContext.fetch(descriptor)
    }

    /// Mark a document as FHIR synced.
    func markDocumentFHIRSynced(localId: String, serverId: String) throws {
        let descriptor = FetchDescriptor<LocalDocumentReference>(
            predicate: #Predicate { $0.localId == localId }
        )
        guard let document = try modelContext.fetch(descriptor).first else { return }

        document.serverId = serverId
        document.fhirSyncStatus = .synced
        document.syncError = nil
        document.updatedAt = Date()

        try modelContext.save()
    }

    /// Delete a document reference.
    func deleteDocumentReference(localId: String) throws {
        let descriptor = FetchDescriptor<LocalDocumentReference>(
            predicate: #Predicate { $0.localId == localId }
        )
        if let document = try modelContext.fetch(descriptor).first {
            modelContext.delete(document)
            try modelContext.save()
        }
    }
}

// MARK: - Conversion Extensions

extension LocalObservation {
    func toFHIRObservation() -> FHIRObservation {
        let components: [ObservationComponent]?
        if type == .bloodPressure {
            var comps: [ObservationComponent] = []
            if let systolic = systolicValue {
                comps.append(ObservationComponent(type: .systolicBP, value: systolic, unit: "mmHg"))
            }
            if let diastolic = diastolicValue {
                comps.append(ObservationComponent(type: .diastolicBP, value: diastolic, unit: "mmHg"))
            }
            components = comps.isEmpty ? nil : comps
        } else {
            components = nil
        }

        return FHIRObservation(
            id: serverId,
            patientId: patientId,
            type: type,
            effectiveDateTime: effectiveDateTime,
            value: value,
            unit: unit,
            components: components,
            interpretation: interpretation,
            performerId: performerId,
            performerType: performerType,
            note: note,
            context: MeasurementContext(fasting: isFasting, postMeal: isPostMeal),
            status: status
        )
    }
}

extension LocalDocumentReference {
    func toFHIRDocumentReference() -> FHIRDocumentReference {
        FHIRDocumentReference(
            id: serverId,
            patientId: patientId,
            documentId: documentId,
            type: type,
            title: title,
            description: documentDescription,
            contentUrl: contentUrl ?? localFilePath,
            contentType: contentType,
            size: size,
            date: date,
            authorId: authorId,
            authorName: authorName,
            authorType: authorType,
            status: documentStatus
        )
    }
}
