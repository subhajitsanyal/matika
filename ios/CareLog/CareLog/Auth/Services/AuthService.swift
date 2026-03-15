//
//  AuthService.swift
//  CareLog
//
//  Authentication service using AWS Amplify Cognito
//

import Foundation
import Amplify
import AWSCognitoAuthPlugin
import Combine
import AWSPluginsCore

/// Authentication state for the CareLog app.
enum AuthState: Equatable {
    case loading
    case notAuthenticated
    case authenticated(CareLogUser)
    case error(String)

    static func == (lhs: AuthState, rhs: AuthState) -> Bool {
        switch (lhs, rhs) {
        case (.loading, .loading):
            return true
        case (.notAuthenticated, .notAuthenticated):
            return true
        case let (.authenticated(user1), .authenticated(user2)):
            return user1.userId == user2.userId
        case let (.error(msg1), .error(msg2)):
            return msg1 == msg2
        default:
            return false
        }
    }
}

/// Represents a CareLog user with their persona type.
struct CareLogUser: Identifiable, Equatable {
    let id: String
    var userId: String { id }
    let email: String
    let name: String
    let personaType: PersonaType
    let linkedPatientId: String?

    init(
        userId: String,
        email: String,
        name: String,
        personaType: PersonaType,
        linkedPatientId: String? = nil
    ) {
        self.id = userId
        self.email = email
        self.name = name
        self.personaType = personaType
        self.linkedPatientId = linkedPatientId
    }
}

/// User persona types as defined in the PRD.
enum PersonaType: String, CaseIterable, Codable {
    case patient
    case attendant
    case relative
    case doctor

    init(from string: String?) {
        switch string?.lowercased() {
        case "patient": self = .patient
        case "attendant": self = .attendant
        case "relative": self = .relative
        case "doctor": self = .doctor
        default: self = .patient
        }
    }
}

/// Authentication service using AWS Amplify Cognito.
///
/// Handles:
/// - User sign in/sign out
/// - User registration
/// - Token management (automatic refresh handled by Amplify)
/// - User attribute management
@MainActor
class AuthService: ObservableObject {
    static let shared = AuthService()

    @Published private(set) var authState: AuthState = .loading
    @Published private(set) var currentUser: CareLogUser?

    private var authStateListener: AnyCancellable?

    init() {
        setupAuthStateListener()
    }

    // MARK: - Public Methods

    /// Get the current user.
    func getCurrentUser() async -> CareLogUser? {
        if currentUser == nil {
            await initialize()
        }
        return currentUser
    }

    /// Initialize and check current authentication session.
    func initialize() async {
        authState = .loading
        do {
            let session = try await Amplify.Auth.fetchAuthSession()
            if session.isSignedIn {
                let user = try await fetchCurrentUser()
                currentUser = user
                authState = .authenticated(user)
            } else {
                authState = .notAuthenticated
            }
        } catch {
            print("AuthService: Failed to check session: \(error)")
            authState = .notAuthenticated
        }
    }

    /// Sign in with email and password.
    func signIn(email: String, password: String) async throws -> CareLogUser {
        authState = .loading
        do {
            let result = try await Amplify.Auth.signIn(username: email, password: password)

            if result.isSignedIn {
                let user = try await fetchCurrentUser()
                currentUser = user
                authState = .authenticated(user)
                return user
            } else {
                authState = .notAuthenticated
                throw AuthError.signInIncomplete(nextStep: "\(result.nextStep)")
            }
        } catch {
            authState = .error(error.localizedDescription)
            throw error
        }
    }

    /// Sign up a new user (relative flow).
    func signUp(
        email: String,
        password: String,
        name: String,
        personaType: PersonaType
    ) async throws -> Bool {
        let userAttributes = [
            AuthUserAttribute(.email, value: email),
            AuthUserAttribute(.name, value: name),
            AuthUserAttribute(.custom("persona_type"), value: personaType.rawValue)
        ]

        let options = AuthSignUpRequest.Options(userAttributes: userAttributes)

        do {
            let result = try await Amplify.Auth.signUp(
                username: email,
                password: password,
                options: options
            )

            switch result.nextStep {
            case .confirmUser:
                return false // Needs confirmation
            case .done:
                return true // Already confirmed
            @unknown default:
                return false
            }
        } catch {
            print("AuthService: Sign up failed: \(error)")
            throw error
        }
    }

    /// Confirm sign up with verification code.
    func confirmSignUp(email: String, code: String) async throws {
        do {
            _ = try await Amplify.Auth.confirmSignUp(for: email, confirmationCode: code)
        } catch {
            print("AuthService: Confirm sign up failed: \(error)")
            throw error
        }
    }

    /// Authenticate an attendant.
    func authenticateAttendant(email: String, password: String) async throws -> AttendantAuthResult {
        let user = try await signIn(email: email, password: password)

        // Get user groups and access token from Cognito
        let session = try await Amplify.Auth.fetchAuthSession()
        var groups: [String] = []
        var accessToken = ""

        if let tokensProvider = session as? (any AuthCognitoTokensProvider) {
            let tokens = try tokensProvider.getCognitoTokens().get()
            accessToken = tokens.accessToken

            // Parse groups from ID token claims
            if let payload = tokens.idToken.split(separator: ".").dropFirst().first,
               let data = Data(base64Encoded: String(payload) + "=="),
               let claims = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let cognitoGroups = claims["cognito:groups"] as? [String] {
                groups = cognitoGroups
            }
        }

        return AttendantAuthResult(userId: user.userId, name: user.name, groups: groups, accessToken: accessToken)
    }

    /// Sign out the current user.
    func signOut() async {
        _ = await Amplify.Auth.signOut()
        currentUser = nil
        authState = .notAuthenticated
    }

    /// Get the current access token for API calls.
    func getAccessToken() async throws -> String {
        let session = try await Amplify.Auth.fetchAuthSession()

        guard let tokensProvider = session as? (any AuthCognitoTokensProvider) else {
            throw AuthError.noTokens
        }

        let tokens = try tokensProvider.getCognitoTokens().get()
        return tokens.accessToken
    }

    /// Get the current ID token for API calls.
    func getIdToken() async throws -> String {
        let session = try await Amplify.Auth.fetchAuthSession()

        guard let tokensProvider = session as? (any AuthCognitoTokensProvider) else {
            throw AuthError.noTokens
        }

        let tokens = try tokensProvider.getCognitoTokens().get()
        return tokens.idToken
    }

    /// Resend confirmation code.
    func resendConfirmationCode(email: String) async throws {
        _ = try await Amplify.Auth.resendSignUpCode(for: email)
    }

    /// Reset password - request code.
    func resetPassword(email: String) async throws {
        _ = try await Amplify.Auth.resetPassword(for: email)
    }

    /// Reset password - confirm with code.
    func confirmResetPassword(email: String, newPassword: String, code: String) async throws {
        try await Amplify.Auth.confirmResetPassword(
            for: email,
            with: newPassword,
            confirmationCode: code
        )
    }

    // MARK: - Private Methods

    private func setupAuthStateListener() {
        authStateListener = Amplify.Hub.publisher(for: .auth)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                switch event.eventName {
                case HubPayload.EventName.Auth.signedIn:
                    Task { [weak self] in
                        await self?.initialize()
                    }
                case HubPayload.EventName.Auth.signedOut:
                    self?.currentUser = nil
                    self?.authState = .notAuthenticated
                case HubPayload.EventName.Auth.sessionExpired:
                    self?.currentUser = nil
                    self?.authState = .notAuthenticated
                default:
                    break
                }
            }
    }

    private func fetchCurrentUser() async throws -> CareLogUser {
        let attributes = try await Amplify.Auth.fetchUserAttributes()

        let email = attributes.first { $0.key == .email }?.value ?? ""
        let name = attributes.first { $0.key == .name }?.value ?? ""
        let personaTypeString = attributes.first { $0.key == .custom("persona_type") }?.value
        let linkedPatientId = attributes.first { $0.key == .custom("linked_patient_id") }?.value

        let userId = try await Amplify.Auth.getCurrentUser().userId

        return CareLogUser(
            userId: userId,
            email: email,
            name: name,
            personaType: PersonaType(from: personaTypeString),
            linkedPatientId: linkedPatientId
        )
    }
}

/// Result of attendant authentication.
struct AttendantAuthResult {
    let userId: String
    let name: String
    let groups: [String]
    let accessToken: String
}

// MARK: - Auth Errors

enum AuthError: LocalizedError {
    case signInIncomplete(nextStep: String)
    case noTokens
    case unknown(Error)

    var errorDescription: String? {
        switch self {
        case .signInIncomplete(let nextStep):
            return "Sign in incomplete. Next step: \(nextStep)"
        case .noTokens:
            return "No authentication tokens available"
        case .unknown(let error):
            return error.localizedDescription
        }
    }
}
