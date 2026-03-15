//
//  VitalType.swift
//  CareLog
//
//  Vital types supported by CareLog with LOINC codes
//

import Foundation
import SwiftUI

/// Enumeration of vital types supported by CareLog.
///
/// Each vital type includes its LOINC code for FHIR compliance
/// and display properties for the UI.
enum VitalType: String, CaseIterable, Identifiable {
    case bloodPressureSystolic
    case bloodPressureDiastolic
    case glucose
    case temperature
    case weight
    case pulse
    case spo2

    var id: String { rawValue }

    /// LOINC code for FHIR Observation mapping.
    var loincCode: String {
        switch self {
        case .bloodPressureSystolic: return "8480-6"
        case .bloodPressureDiastolic: return "8462-4"
        case .glucose: return "2339-0"
        case .temperature: return "8310-5"
        case .weight: return "29463-7"
        case .pulse: return "8867-4"
        case .spo2: return "2708-6"
        }
    }

    /// Display name for the vital type.
    var displayName: String {
        switch self {
        case .bloodPressureSystolic: return "Blood Pressure (Systolic)"
        case .bloodPressureDiastolic: return "Blood Pressure (Diastolic)"
        case .glucose: return "Glucose"
        case .temperature: return "Temperature"
        case .weight: return "Weight"
        case .pulse: return "Pulse"
        case .spo2: return "SpO2"
        }
    }

    /// Short display name for dashboard buttons.
    var shortName: String {
        switch self {
        case .bloodPressureSystolic, .bloodPressureDiastolic: return "BP"
        case .glucose: return "Glucose"
        case .temperature: return "Temp"
        case .weight: return "Weight"
        case .pulse: return "Pulse"
        case .spo2: return "SpO2"
        }
    }

    /// SF Symbol icon name.
    var iconName: String {
        switch self {
        case .bloodPressureSystolic, .bloodPressureDiastolic: return "heart.fill"
        case .glucose: return "drop.fill"
        case .temperature: return "thermometer"
        case .weight: return "scalemass.fill"
        case .pulse: return "waveform.path.ecg"
        case .spo2: return "lungs.fill"
        }
    }

    /// Color for the vital type.
    var color: Color {
        switch self {
        case .bloodPressureSystolic, .bloodPressureDiastolic: return Color(red: 0.9, green: 0.22, blue: 0.21)
        case .glucose: return Color(red: 0.56, green: 0.14, blue: 0.67)
        case .temperature: return Color(red: 0.98, green: 0.55, blue: 0)
        case .weight: return Color(red: 0.26, green: 0.63, blue: 0.28)
        case .pulse: return Color(red: 0.85, green: 0.11, blue: 0.38)
        case .spo2: return Color(red: 0.12, green: 0.53, blue: 0.9)
        }
    }

    /// Default unit for the vital type.
    var defaultUnit: String {
        switch self {
        case .bloodPressureSystolic, .bloodPressureDiastolic: return "mmHg"
        case .glucose: return "mg/dL"
        case .temperature: return "°C"
        case .weight: return "kg"
        case .pulse: return "bpm"
        case .spo2: return "%"
        }
    }

    /// Valid range for the vital type.
    var validRange: ClosedRange<Double> {
        switch self {
        case .bloodPressureSystolic: return 60...250
        case .bloodPressureDiastolic: return 40...150
        case .glucose: return 20...600
        case .temperature: return 35...42
        case .weight: return 1...300
        case .pulse: return 30...220
        case .spo2: return 50...100
        }
    }
}
