//
//  CareLogRoutes.swift
//  CareLog
//
//  Navigation routes for CareLog app
//

import Foundation

/// Navigation routes for CareLog app.
///
/// Defines all possible navigation destinations organized by feature area.
enum CareLogRoute: Hashable {
    // Authentication
    case login
    case registration
    case forgotPassword

    // Dashboards
    case patientDashboard
    case relativeDashboard
    case attendantDashboard

    // Vital logging
    case bloodPressure
    case glucose
    case temperature
    case weight
    case pulse
    case spo2

    // Media capture
    case prescriptionScan
    case medicalPhoto
    case voiceNote
    case videoNote

    // History and trends
    case history
    case trends(vitalType: VitalType?)

    // Settings and configuration
    case settings
    case careTeam
    case thresholds
    case reminders
    case notifications

    // Alerts
    case alerts
    case alertDetail(alertId: String)

    // Profile
    case profile
    case patientProfile

    // LLM Chat (placeholder)
    case chat

    // Data management
    case exportData
    case deleteAccount
}

/// Tab items for the main navigation.
enum MainTab: String, CaseIterable, Identifiable {
    case home
    case history
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "Home"
        case .history: return "History"
        case .settings: return "Settings"
        }
    }

    var iconName: String {
        switch self {
        case .home: return "house.fill"
        case .history: return "clock.fill"
        case .settings: return "gearshape.fill"
        }
    }
}
