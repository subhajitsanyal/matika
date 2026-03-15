//
//  CareLogApp.swift
//  CareLog
//
//  CareLog - Mobile health monitoring application for elderly patients
//  Built on Stanford Spezi framework with FHIR R4 support
//

import SwiftUI
import Spezi

/// Main entry point for the CareLog iOS application.
///
/// This app targets elderly patients, their caregivers, and attending physicians.
/// It enables structured logging of clinical vitals with offline-first local storage
/// and automatic background sync to an AWS-hosted FHIR-compliant backend.
@main
struct CareLogApp: App {
    @UIApplicationDelegateAdaptor(CareLogAppDelegate.self) var appDelegate
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appState)
                .spezi(appDelegate)
        }
    }
}

/// Application delegate for CareLog.
///
/// Handles:
/// - Spezi framework configuration
/// - AWS Amplify initialization
/// - Background sync registration
class CareLogAppDelegate: SpeziAppDelegate {
    override var configuration: Configuration {
        Configuration(standard: CareLogStandard()) {
            // Spezi modules will be configured here
            // AccountConfiguration will be added in T-012
            // FHIRConfiguration will be added in T-021
        }
    }
}

/// Global application state.
///
/// Manages:
/// - Authentication state
/// - User persona (patient, attendant, relative)
/// - Sync status
@MainActor
class AppState: ObservableObject {
    @Published var isAuthenticated = false
    @Published var currentPersona: UserPersona = .patient
    @Published var syncStatus: SyncStatus = .idle

    enum UserPersona: String, CaseIterable {
        case patient
        case attendant
        case relative
        case doctor
    }

    enum SyncStatus {
        case idle
        case syncing
        case complete
        case error(String)
    }
}
