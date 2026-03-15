import Foundation

/// API service for relative-specific operations.
/// Fetches patient data, vitals summary, thresholds, reminders, and alerts.
actor RelativeApiService {
    static let shared = RelativeApiService()

    private let authService = AuthService.shared
    private let session: URLSession
    private let apiBaseURL = "https://api.carelog.app" // TODO: Get from config

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        session = URLSession(configuration: config)
    }

    // MARK: - Patient Summary

    func getPatientSummary(patientId: String) async throws -> PatientSummary {
        let url = URL(string: "\(apiBaseURL)/patients/\(patientId)/summary")!
        let data = try await authorizedRequest(url: url, method: "GET")
        return try JSONDecoder.carelogDecoder.decode(PatientSummary.self, from: data)
    }

    // MARK: - Observations

    func getObservations(
        patientId: String,
        vitalType: VitalTypeAPI? = nil,
        startDate: Date? = nil,
        endDate: Date? = nil
    ) async throws -> [VitalObservation] {
        var components = URLComponents(string: "\(apiBaseURL)/patients/\(patientId)/observations")!
        var queryItems: [URLQueryItem] = []

        if let vitalType = vitalType {
            queryItems.append(URLQueryItem(name: "vitalType", value: vitalType.rawValue))
        }
        if let startDate = startDate {
            queryItems.append(URLQueryItem(name: "startDate", value: ISO8601DateFormatter().string(from: startDate)))
        }
        if let endDate = endDate {
            queryItems.append(URLQueryItem(name: "endDate", value: ISO8601DateFormatter().string(from: endDate)))
        }

        if !queryItems.isEmpty {
            components.queryItems = queryItems
        }

        let data = try await authorizedRequest(url: components.url!, method: "GET")
        let response = try JSONDecoder.carelogDecoder.decode(ObservationsResponse.self, from: data)
        return response.observations
    }

    // MARK: - Thresholds

    func getThresholds(patientId: String) async throws -> [VitalThreshold] {
        let url = URL(string: "\(apiBaseURL)/patients/\(patientId)/thresholds")!
        let data = try await authorizedRequest(url: url, method: "GET")
        let response = try JSONDecoder.carelogDecoder.decode(ThresholdsResponse.self, from: data)
        return response.thresholds
    }

    func updateThreshold(patientId: String, threshold: VitalThreshold) async throws {
        let url = URL(string: "\(apiBaseURL)/patients/\(patientId)/thresholds")!
        let body = try JSONEncoder().encode(threshold)
        _ = try await authorizedRequest(url: url, method: "PUT", body: body)
    }

    func updateThreshold(
        patientId: String,
        vitalType: VitalTypeAPI,
        minValue: Double?,
        maxValue: Double?
    ) async throws {
        let url = URL(string: "\(apiBaseURL)/patients/\(patientId)/thresholds")!
        let payload: [String: Any?] = [
            "vitalType": vitalType.rawValue,
            "minValue": minValue,
            "maxValue": maxValue
        ]
        let body = try JSONSerialization.data(withJSONObject: payload.compactMapValues { $0 })
        _ = try await authorizedRequest(url: url, method: "PUT", body: body)
    }

    // MARK: - Reminders

    func getReminderConfig(patientId: String) async throws -> [ReminderConfig] {
        let url = URL(string: "\(apiBaseURL)/patients/\(patientId)/reminders")!
        let data = try await authorizedRequest(url: url, method: "GET")
        let response = try JSONDecoder.carelogDecoder.decode(RemindersResponse.self, from: data)
        return response.reminders
    }

    func updateReminderConfig(patientId: String, config: ReminderConfig) async throws {
        let url = URL(string: "\(apiBaseURL)/patients/\(patientId)/reminders")!
        let body = try JSONEncoder().encode(config)
        _ = try await authorizedRequest(url: url, method: "PUT", body: body)
    }

    func getReminderConfigs(patientId: String) async throws -> [ReminderConfigModel] {
        let configs = try await getReminderConfig(patientId: patientId)
        return configs.map { config in
            ReminderConfigModel(
                vitalType: config.vitalType,
                windowHours: config.windowHours,
                gracePeriodMinutes: config.gracePeriodMinutes,
                enabled: config.enabled
            )
        }
    }

    func updateReminderConfig(
        patientId: String,
        vitalType: VitalTypeAPI,
        windowHours: Int,
        gracePeriodMinutes: Int,
        enabled: Bool
    ) async throws {
        let url = URL(string: "\(apiBaseURL)/patients/\(patientId)/reminders")!
        let payload: [String: Any] = [
            "vitalType": vitalType.rawValue,
            "windowHours": windowHours,
            "gracePeriodMinutes": gracePeriodMinutes,
            "enabled": enabled
        ]
        let body = try JSONSerialization.data(withJSONObject: payload)
        _ = try await authorizedRequest(url: url, method: "PUT", body: body)
    }

    // MARK: - Alerts

    func getAlerts(patientId: String, unreadOnly: Bool = false) async throws -> [Alert] {
        var components = URLComponents(string: "\(apiBaseURL)/patients/\(patientId)/alerts")!
        if unreadOnly {
            components.queryItems = [URLQueryItem(name: "unreadOnly", value: "true")]
        }

        let data = try await authorizedRequest(url: components.url!, method: "GET")
        let response = try JSONDecoder.carelogDecoder.decode(AlertsResponse.self, from: data)
        return response.alerts
    }

    func markAlertAsRead(alertId: String) async throws {
        let url = URL(string: "\(apiBaseURL)/alerts/\(alertId)")!
        let body = try JSONEncoder().encode(["read": true])
        _ = try await authorizedRequest(url: url, method: "PATCH", body: body)
    }

    // MARK: - Care Team

    func getCareTeam(patientId: String) async throws -> CareTeam {
        let url = URL(string: "\(apiBaseURL)/patients/\(patientId)/care-team")!
        let data = try await authorizedRequest(url: url, method: "GET")
        return try JSONDecoder.carelogDecoder.decode(CareTeam.self, from: data)
    }

    func inviteAttendant(patientId: String, email: String, name: String) async throws {
        let url = URL(string: "\(apiBaseURL)/patients/\(patientId)/invite-attendant")!
        let body = try JSONEncoder().encode(["email": email, "name": name])
        _ = try await authorizedRequest(url: url, method: "POST", body: body)
    }

    func inviteDoctor(patientId: String, email: String) async throws {
        let url = URL(string: "\(apiBaseURL)/patients/\(patientId)/invite-doctor")!
        let body = try JSONEncoder().encode(["email": email])
        _ = try await authorizedRequest(url: url, method: "POST", body: body)
    }

    // MARK: - Private

    private func authorizedRequest(url: URL, method: String, body: Data? = nil) async throws -> Data {
        let token = try await authService.getAccessToken()

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let body = body {
            request.httpBody = body
        }

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.httpError(statusCode: httpResponse.statusCode)
        }

        return data
    }
}

// MARK: - Response Types

private struct ObservationsResponse: Codable {
    let observations: [VitalObservation]
}

private struct ThresholdsResponse: Codable {
    let thresholds: [VitalThreshold]
}

private struct RemindersResponse: Codable {
    let reminders: [ReminderConfig]
}

private struct AlertsResponse: Codable {
    let alerts: [Alert]
}

// MARK: - Data Models

enum VitalTypeAPI: String, Codable, CaseIterable {
    case bloodPressure = "BLOOD_PRESSURE"
    case glucose = "GLUCOSE"
    case temperature = "TEMPERATURE"
    case weight = "WEIGHT"
    case pulse = "PULSE"
    case spo2 = "SPO2"

    var displayName: String {
        switch self {
        case .bloodPressure: return "Blood Pressure"
        case .glucose: return "Glucose"
        case .temperature: return "Temperature"
        case .weight: return "Weight"
        case .pulse: return "Pulse"
        case .spo2: return "SpO2"
        }
    }

    var iconName: String {
        switch self {
        case .bloodPressure: return "heart.fill"
        case .glucose: return "drop.fill"
        case .temperature: return "thermometer"
        case .weight: return "scalemass.fill"
        case .pulse: return "waveform.path.ecg"
        case .spo2: return "lungs.fill"
        }
    }

    var color: CareLogColors.VitalColor {
        switch self {
        case .bloodPressure: return .bloodPressure
        case .glucose: return .glucose
        case .temperature: return .temperature
        case .weight: return .weight
        case .pulse: return .pulse
        case .spo2: return .spO2
        }
    }
}

enum ThresholdStatus: String, Codable {
    case normal = "NORMAL"
    case low = "LOW"
    case high = "HIGH"
    case critical = "CRITICAL"

    var displayName: String {
        switch self {
        case .normal: return "Normal"
        case .low: return "Low"
        case .high: return "High"
        case .critical: return "Critical"
        }
    }
}

enum AlertTypeAPI: String, Codable {
    case thresholdBreach = "THRESHOLD_BREACH"
    case reminderLapse = "REMINDER_LAPSE"
    case system = "SYSTEM"
}

struct PatientSummary: Codable {
    let patientId: String
    let patientName: String
    let latestVitals: [String: LatestVital]
    let unreadAlertCount: Int
    let lastActivityTime: Date?
}

struct LatestVital: Codable {
    let value: Double
    let unit: String
    let timestamp: Date
    let status: ThresholdStatus
    let secondaryValue: Double?
}

struct VitalObservation: Codable, Identifiable {
    let id: String
    let vitalType: VitalTypeAPI
    let value: Double
    let secondaryValue: Double?
    let unit: String
    let timestamp: Date
    let performerName: String?
    let status: ThresholdStatus
}

struct VitalThreshold: Codable, Identifiable {
    var id: String { vitalType.rawValue }
    let vitalType: VitalTypeAPI
    var minValue: Double?
    var maxValue: Double?
    let unit: String
    let setByDoctor: Bool
    let doctorName: String?
}

struct ReminderConfig: Codable, Identifiable {
    var id: String { vitalType.rawValue }
    let vitalType: VitalTypeAPI
    var windowHours: Int
    var gracePeriodMinutes: Int
    var enabled: Bool
}

struct Alert: Codable, Identifiable {
    let id: String
    let alertType: AlertTypeAPI
    let vitalType: VitalTypeAPI?
    let value: Double?
    let message: String
    let timestamp: Date
    var read: Bool
}

struct CareTeam: Codable {
    let attendants: [CareTeamMember]
    let doctors: [CareTeamMember]
    let relatives: [CareTeamMember]
    let pendingInvites: [PendingInvite]
}

struct CareTeamMember: Codable, Identifiable {
    let id: String
    let name: String
    let email: String?
    let phone: String?
    let role: String
    let joinedAt: Date?
}

struct PendingInvite: Codable, Identifiable {
    let id: String
    let email: String
    let role: String
    let sentAt: Date
}

// MARK: - Errors

enum APIError: LocalizedError {
    case invalidResponse
    case httpError(statusCode: Int)
    case decodingError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let statusCode):
            return "HTTP error: \(statusCode)"
        case .decodingError(let error):
            return "Decoding error: \(error.localizedDescription)"
        }
    }
}

// MARK: - JSON Decoder Extension

extension JSONDecoder {
    static var carelogDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
}

// MARK: - CareLogColors Extension

extension CareLogColors {
    enum VitalColor {
        case bloodPressure
        case glucose
        case temperature
        case weight
        case pulse
        case spO2
    }
}
