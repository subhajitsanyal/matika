import Foundation
import UIKit

/// Service for registering device tokens with the backend.
actor DeviceTokenService {
    static let shared = DeviceTokenService()

    private let authService = AuthService.shared
    private let session: URLSession
    private let apiBaseURL = "https://api.carelog.app" // TODO: Get from config

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        session = URLSession(configuration: config)
    }

    /// Get the unique device identifier.
    private func getDeviceId() -> String {
        // Use identifierForVendor as device ID
        return UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
    }

    /// Register device token with the backend.
    func registerToken(token: String) async throws {
        let accessToken = try await authService.getAccessToken()
        let deviceId = await getDeviceId()

        let url = URL(string: "\(apiBaseURL)/device-tokens")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "deviceToken": token,
            "platform": "ios",
            "deviceId": deviceId
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw DeviceTokenError.registrationFailed
        }

        print("Device token registered successfully")
    }

    /// Unregister device token from the backend.
    func unregisterToken() async throws {
        let accessToken = try await authService.getAccessToken()
        let deviceId = await getDeviceId()

        var components = URLComponents(string: "\(apiBaseURL)/device-tokens")!
        components.queryItems = [URLQueryItem(name: "deviceId", value: deviceId)]

        var request = URLRequest(url: components.url!)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let (_, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw DeviceTokenError.unregistrationFailed
        }

        print("Device token unregistered successfully")
    }
}

// MARK: - Errors

enum DeviceTokenError: LocalizedError {
    case registrationFailed
    case unregistrationFailed

    var errorDescription: String? {
        switch self {
        case .registrationFailed:
            return "Failed to register device token"
        case .unregistrationFailed:
            return "Failed to unregister device token"
        }
    }
}
