//
//  MockAuthService.swift
//  CareLogTests
//
//  Mock AuthService for unit testing
//

import Foundation
@testable import CareLog

/// Mock AuthService for unit testing ViewModels.
///
/// The ViewModels use the AuthService defined in AuthService.swift,
/// which returns CareLogUser? from getCurrentUser().
@MainActor
class MockAuthService: AuthService {
    var mockUser: CareLogUser?
    var getCurrentUserCallCount = 0

    override func getCurrentUser() async -> CareLogUser? {
        getCurrentUserCallCount += 1
        return mockUser
    }

    // Helper to create a test user
    static func createTestUser(
        userId: String = "test-user-123",
        email: String = "test@example.com",
        name: String = "Test User",
        personaType: PersonaType = .patient,
        linkedPatientId: String? = "patient-456"
    ) -> CareLogUser {
        CareLogUser(
            userId: userId,
            email: email,
            name: name,
            personaType: personaType,
            linkedPatientId: linkedPatientId
        )
    }
}

