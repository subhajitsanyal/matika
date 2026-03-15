import SwiftUI

/// CareLog Color Palette - WCAG AA Compliant
///
/// Primary colors chosen for high contrast and accessibility.
/// Minimum contrast ratio: 4.5:1 for normal text, 3:1 for large text.
enum CareLogColors {
    // MARK: - Primary Colors
    static let primary = Color(hex: 0x1565C0)
    static let primaryDark = Color(hex: 0x0D47A1)
    static let primaryLight = Color(hex: 0x42A5F5)
    static let onPrimary = Color.white

    // MARK: - Secondary Colors
    static let secondary = Color(hex: 0x00897B)
    static let secondaryDark = Color(hex: 0x00695C)
    static let secondaryLight = Color(hex: 0x4DB6AC)
    static let onSecondary = Color.white

    // MARK: - Background & Surface
    static let background = Color(hex: 0xF5F5F5)
    static let surface = Color.white
    static let surfaceVariant = Color(hex: 0xE8E8E8)

    // MARK: - Text Colors
    static let onBackground = Color(hex: 0x1A1A1A)
    static let onSurface = Color(hex: 0x1A1A1A)
    static let onSurfaceVariant = Color(hex: 0x5C5C5C)

    // MARK: - Vital Type Colors
    static let bloodPressure = Color(hex: 0xE53935)
    static let glucose = Color(hex: 0x8E24AA)
    static let temperature = Color(hex: 0xFF6F00)
    static let weight = Color(hex: 0x43A047)
    static let pulse = Color(hex: 0xD81B60)
    static let spO2 = Color(hex: 0x1E88E5)
    static let upload = Color(hex: 0x546E7A)
    static let chat = Color(hex: 0x00ACC1)

    // MARK: - Status Colors
    static let success = Color(hex: 0x2E7D32)
    static let warning = Color(hex: 0xF57C00)
    static let error = Color(hex: 0xC62828)
    static let info = Color(hex: 0x1565C0)

    // MARK: - Alert Threshold Colors
    static let normal = Color(hex: 0x4CAF50)
    static let elevated = Color(hex: 0xFFC107)
    static let critical = Color(hex: 0xF44336)
}

// MARK: - Color Extension for Hex Support

extension Color {
    init(hex: UInt, alpha: Double = 1.0) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue: Double(hex & 0xFF) / 255.0,
            opacity: alpha
        )
    }
}

// MARK: - Dashboard Item

/// Dashboard menu item types including vitals and actions.
enum DashboardItem: String, CaseIterable, Identifiable {
    case bloodPressure = "blood_pressure"
    case glucose = "glucose"
    case temperature = "temperature"
    case weight = "weight"
    case pulse = "pulse"
    case spO2 = "spo2"
    case upload = "upload"
    case chat = "chat"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .bloodPressure: return "Blood Pressure"
        case .glucose: return "Blood Glucose"
        case .temperature: return "Temperature"
        case .weight: return "Weight"
        case .pulse: return "Heart Rate"
        case .spO2: return "Oxygen"
        case .upload: return "Upload"
        case .chat: return "Chat"
        }
    }

    var color: Color {
        switch self {
        case .bloodPressure: return CareLogColors.bloodPressure
        case .glucose: return CareLogColors.glucose
        case .temperature: return CareLogColors.temperature
        case .weight: return CareLogColors.weight
        case .pulse: return CareLogColors.pulse
        case .spO2: return CareLogColors.spO2
        case .upload: return CareLogColors.upload
        case .chat: return CareLogColors.chat
        }
    }

    var iconName: String {
        switch self {
        case .bloodPressure: return "heart.fill"
        case .glucose: return "drop.fill"
        case .temperature: return "thermometer"
        case .weight: return "scalemass.fill"
        case .pulse: return "waveform.path.ecg"
        case .spO2: return "lungs.fill"
        case .upload: return "arrow.up.doc.fill"
        case .chat: return "message.fill"
        }
    }

    var label: String {
        switch self {
        case .bloodPressure: return "Blood\nPressure"
        case .glucose: return "Blood\nGlucose"
        case .temperature: return "Temperature"
        case .weight: return "Weight"
        case .pulse: return "Heart Rate"
        case .spO2: return "Oxygen\nLevel"
        case .upload: return "Upload\nMedia"
        case .chat: return "Health\nChat"
        }
    }

    /// Returns only vitals (excludes upload and chat)
    static var vitals: [DashboardItem] {
        [.bloodPressure, .glucose, .temperature, .weight, .pulse, .spO2]
    }

    /// Returns all dashboard items including actions
    static var dashboardItems: [DashboardItem] {
        allCases
    }
}
