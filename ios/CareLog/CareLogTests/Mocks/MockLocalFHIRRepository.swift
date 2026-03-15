//
//  MockLocalFHIRRepository.swift
//  CareLogTests
//
//  Mock LocalFHIRRepository for unit testing
//

import Foundation
@testable import CareLog

/// Mock LocalFHIRRepository for unit testing ViewModels.
///
/// Note: The actual LocalFHIRRepository uses SwiftData and @MainActor.
/// This mock provides a simplified interface for testing.
@MainActor
class MockLocalFHIRRepository {
    var savedObservations: [FHIRObservation] = []
    var shouldThrowError = false
    var errorToThrow: Error = NSError(domain: "MockError", code: 1, userInfo: [NSLocalizedDescriptionKey: "Mock save error"])

    var saveObservationCallCount = 0
    var lastSavedObservation: FHIRObservation?

    /// Mock implementation of saveObservation.
    /// The actual implementation takes FHIRObservation and returns String (localId).
    func saveObservation(_ observation: FHIRObservation) throws -> String {
        saveObservationCallCount += 1
        lastSavedObservation = observation

        if shouldThrowError {
            throw errorToThrow
        }

        savedObservations.append(observation)
        return UUID().uuidString
    }

    func reset() {
        savedObservations = []
        shouldThrowError = false
        saveObservationCallCount = 0
        lastSavedObservation = nil
    }
}

/// Protocol-based mock for dependency injection.
/// This can be used when refactoring to protocol-based DI.
protocol LocalFHIRRepositoryProtocol {
    func saveObservation(_ observation: FHIRObservation) throws -> String
    func getObservation(localId: String) throws -> FHIRObservation?
    func getObservationsForPatient(_ patientId: String) throws -> [FHIRObservation]
}
