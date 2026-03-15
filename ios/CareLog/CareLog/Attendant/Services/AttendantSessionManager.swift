import Foundation
import Security

/// Manages attendant session on a patient's device.
/// Allows attendant to log in temporarily to record vitals on behalf of patient.
@MainActor
class AttendantSessionManager: ObservableObject {
    static let shared = AttendantSessionManager()

    @Published var currentAttendant: AttendantInfo?
    @Published var isAttendantMode: Bool = false

    private let authService = AuthService.shared
    private let keychainService = "com.carelog.attendant"
    private let sessionDuration: TimeInterval = 8 * 60 * 60 // 8 hours

    private init() {
        // Restore session if valid
        restoreSession()
    }

    /// Restore attendant session from keychain if still valid.
    private func restoreSession() {
        guard let sessionData = loadFromKeychain(key: "session"),
              let session = try? JSONDecoder().decode(AttendantSession.self, from: sessionData),
              Date() < session.expiresAt else {
            // Clear expired session
            clearSession()
            return
        }

        currentAttendant = session.attendantInfo
        isAttendantMode = true
    }

    /// Log in as attendant.
    func loginAsAttendant(email: String, password: String) async throws -> AttendantInfo {
        // Authenticate with Cognito
        let authResult = try await authService.authenticateAttendant(email: email, password: password)

        // Verify user is in attendants group
        guard authResult.groups.contains("attendants") else {
            throw AttendantSessionError.notAnAttendant
        }

        let attendantInfo = AttendantInfo(
            id: authResult.userId,
            name: authResult.name
        )

        let session = AttendantSession(
            attendantInfo: attendantInfo,
            accessToken: authResult.accessToken,
            expiresAt: Date().addingTimeInterval(sessionDuration)
        )

        // Save session to keychain
        if let sessionData = try? JSONEncoder().encode(session) {
            saveToKeychain(key: "session", data: sessionData)
        }

        currentAttendant = attendantInfo
        isAttendantMode = true

        return attendantInfo
    }

    /// Log out attendant and return to patient mode.
    func logoutAttendant() {
        clearSession()
        currentAttendant = nil
        isAttendantMode = false
    }

    /// Clear stored session data.
    private func clearSession() {
        deleteFromKeychain(key: "session")
    }

    /// Get the current performer info for FHIR observations.
    func getPerformerInfo() -> PerformerInfo? {
        guard let attendant = currentAttendant else { return nil }
        return PerformerInfo(
            id: attendant.id,
            name: attendant.name,
            role: "attendant"
        )
    }

    /// Check if session is still valid.
    func isSessionValid() -> Bool {
        guard let sessionData = loadFromKeychain(key: "session"),
              let session = try? JSONDecoder().decode(AttendantSession.self, from: sessionData) else {
            return false
        }
        return Date() < session.expiresAt
    }

    /// Extend session by another session duration.
    func extendSession() {
        guard isAttendantMode,
              let sessionData = loadFromKeychain(key: "session"),
              var session = try? JSONDecoder().decode(AttendantSession.self, from: sessionData) else {
            return
        }

        session.expiresAt = Date().addingTimeInterval(sessionDuration)

        if let newSessionData = try? JSONEncoder().encode(session) {
            saveToKeychain(key: "session", data: newSessionData)
        }
    }

    // MARK: - Keychain Helpers

    private func saveToKeychain(key: String, data: Data) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: key,
            kSecValueData as String: data
        ]

        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    private func loadFromKeychain(key: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess else { return nil }
        return result as? Data
    }

    private func deleteFromKeychain(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: key
        ]

        SecItemDelete(query as CFDictionary)
    }
}

// MARK: - Models

struct AttendantInfo: Codable {
    let id: String
    let name: String
}

struct AttendantSession: Codable {
    let attendantInfo: AttendantInfo
    let accessToken: String
    var expiresAt: Date
}

struct PerformerInfo {
    let id: String
    let name: String
    let role: String
}

// MARK: - Errors

enum AttendantSessionError: LocalizedError {
    case notAnAttendant
    case sessionExpired
    case authenticationFailed

    var errorDescription: String? {
        switch self {
        case .notAnAttendant:
            return "User is not registered as an attendant"
        case .sessionExpired:
            return "Your session has expired. Please log in again."
        case .authenticationFailed:
            return "Authentication failed. Please check your credentials."
        }
    }
}
