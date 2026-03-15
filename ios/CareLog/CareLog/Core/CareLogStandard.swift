//
//  CareLogStandard.swift
//  CareLog
//
//  Spezi Standard implementation for CareLog
//

import Foundation
import Spezi
import SpeziFHIR
import ModelsR4

/// CareLog's implementation of the Spezi Standard protocol.
///
/// This standard defines how CareLog handles FHIR resources,
/// manages health data, and interacts with the Spezi ecosystem.
actor CareLogStandard: Standard {
    /// Process incoming FHIR resources.
    ///
    /// This method is called when FHIR resources are received from
    /// peripheral devices, manual entry, or sync operations.
    /// - Parameter resource: The FHIR resource to process
    func add(resource: ModelsR4.Resource) async throws {
        // Store resource locally and queue for sync
        // Implementation will be added in T-021
        switch resource {
        case let observation as Observation:
            try await processObservation(observation)
        case let documentRef as DocumentReference:
            try await processDocumentReference(documentRef)
        case let patient as Patient:
            try await processPatient(patient)
        default:
            // Log unsupported resource types
            print("CareLogStandard: Unsupported resource type received")
        }
    }

    // MARK: - Private Methods

    private func processObservation(_ observation: Observation) async throws {
        // Will be implemented in T-021
        // Store observation locally and add to sync queue
    }

    private func processDocumentReference(_ docRef: DocumentReference) async throws {
        // Will be implemented in T-021
        // Store document reference and link to S3 upload
    }

    private func processPatient(_ patient: Patient) async throws {
        // Will be implemented in T-021
        // Store patient resource locally
    }
}
