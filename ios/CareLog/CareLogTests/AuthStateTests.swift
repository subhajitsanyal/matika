//
//  AuthStateTests.swift
//  CareLogTests
//
//  Unit tests for AuthState and PersonaType
//

import XCTest
@testable import CareLog

final class AuthStateTests: XCTestCase {

    // MARK: - AuthState Equality Tests

    func testEquality_loading() {
        XCTAssertEqual(AuthState.loading, AuthState.loading)
    }

    func testEquality_notAuthenticated() {
        XCTAssertEqual(AuthState.notAuthenticated, AuthState.notAuthenticated)
    }

    func testEquality_authenticated_sameUser() {
        let user1 = CareLogUser(
            userId: "user-123",
            email: "test@example.com",
            name: "Test User",
            personaType: .patient
        )
        let user2 = CareLogUser(
            userId: "user-123",
            email: "different@example.com",
            name: "Different Name",
            personaType: .relative
        )

        // Same userId should be equal
        XCTAssertEqual(AuthState.authenticated(user1), AuthState.authenticated(user2))
    }

    func testEquality_authenticated_differentUser() {
        let user1 = CareLogUser(
            userId: "user-123",
            email: "test@example.com",
            name: "Test User",
            personaType: .patient
        )
        let user2 = CareLogUser(
            userId: "user-456",
            email: "test@example.com",
            name: "Test User",
            personaType: .patient
        )

        // Different userId should not be equal
        XCTAssertNotEqual(AuthState.authenticated(user1), AuthState.authenticated(user2))
    }

    func testEquality_error_sameMessage() {
        XCTAssertEqual(AuthState.error("Connection failed"), AuthState.error("Connection failed"))
    }

    func testEquality_error_differentMessage() {
        XCTAssertNotEqual(AuthState.error("Connection failed"), AuthState.error("Timeout"))
    }

    func testEquality_differentStates() {
        let user = CareLogUser(
            userId: "user-123",
            email: "test@example.com",
            name: "Test User",
            personaType: .patient
        )

        XCTAssertNotEqual(AuthState.loading, AuthState.notAuthenticated)
        XCTAssertNotEqual(AuthState.loading, AuthState.authenticated(user))
        XCTAssertNotEqual(AuthState.loading, AuthState.error("Error"))
        XCTAssertNotEqual(AuthState.notAuthenticated, AuthState.authenticated(user))
        XCTAssertNotEqual(AuthState.notAuthenticated, AuthState.error("Error"))
        XCTAssertNotEqual(AuthState.authenticated(user), AuthState.error("Error"))
    }

    // MARK: - PersonaType Tests

    func testPersonaType_fromString_patient() {
        XCTAssertEqual(PersonaType(from: "patient"), .patient)
        XCTAssertEqual(PersonaType(from: "Patient"), .patient)
        XCTAssertEqual(PersonaType(from: "PATIENT"), .patient)
    }

    func testPersonaType_fromString_attendant() {
        XCTAssertEqual(PersonaType(from: "attendant"), .attendant)
        XCTAssertEqual(PersonaType(from: "Attendant"), .attendant)
        XCTAssertEqual(PersonaType(from: "ATTENDANT"), .attendant)
    }

    func testPersonaType_fromString_relative() {
        XCTAssertEqual(PersonaType(from: "relative"), .relative)
        XCTAssertEqual(PersonaType(from: "Relative"), .relative)
        XCTAssertEqual(PersonaType(from: "RELATIVE"), .relative)
    }

    func testPersonaType_fromString_doctor() {
        XCTAssertEqual(PersonaType(from: "doctor"), .doctor)
        XCTAssertEqual(PersonaType(from: "Doctor"), .doctor)
        XCTAssertEqual(PersonaType(from: "DOCTOR"), .doctor)
    }

    func testPersonaType_fromString_nil_defaultsToPatient() {
        XCTAssertEqual(PersonaType(from: nil), .patient)
    }

    func testPersonaType_fromString_unknown_defaultsToPatient() {
        XCTAssertEqual(PersonaType(from: "unknown"), .patient)
        XCTAssertEqual(PersonaType(from: "admin"), .patient)
        XCTAssertEqual(PersonaType(from: ""), .patient)
    }

    func testPersonaType_rawValue() {
        XCTAssertEqual(PersonaType.patient.rawValue, "patient")
        XCTAssertEqual(PersonaType.attendant.rawValue, "attendant")
        XCTAssertEqual(PersonaType.relative.rawValue, "relative")
        XCTAssertEqual(PersonaType.doctor.rawValue, "doctor")
    }

    func testPersonaType_allCases() {
        XCTAssertEqual(PersonaType.allCases.count, 4)
        XCTAssertTrue(PersonaType.allCases.contains(.patient))
        XCTAssertTrue(PersonaType.allCases.contains(.attendant))
        XCTAssertTrue(PersonaType.allCases.contains(.relative))
        XCTAssertTrue(PersonaType.allCases.contains(.doctor))
    }

    // MARK: - CareLogUser Tests

    func testCareLogUser_initialization() {
        let user = CareLogUser(
            userId: "user-123",
            email: "test@example.com",
            name: "Test User",
            personaType: .patient,
            linkedPatientId: "patient-456"
        )

        XCTAssertEqual(user.id, "user-123")
        XCTAssertEqual(user.userId, "user-123")
        XCTAssertEqual(user.email, "test@example.com")
        XCTAssertEqual(user.name, "Test User")
        XCTAssertEqual(user.personaType, .patient)
        XCTAssertEqual(user.linkedPatientId, "patient-456")
    }

    func testCareLogUser_initialization_withoutLinkedPatientId() {
        let user = CareLogUser(
            userId: "user-123",
            email: "test@example.com",
            name: "Test User",
            personaType: .relative
        )

        XCTAssertNil(user.linkedPatientId)
    }

    func testCareLogUser_equatable() {
        let user1 = CareLogUser(
            userId: "user-123",
            email: "test@example.com",
            name: "Test User",
            personaType: .patient
        )
        let user2 = CareLogUser(
            userId: "user-123",
            email: "test@example.com",
            name: "Test User",
            personaType: .patient
        )
        let user3 = CareLogUser(
            userId: "user-456",
            email: "test@example.com",
            name: "Test User",
            personaType: .patient
        )

        XCTAssertEqual(user1, user2)
        XCTAssertNotEqual(user1, user3)
    }
}
