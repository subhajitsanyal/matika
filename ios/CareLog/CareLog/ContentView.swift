//
//  ContentView.swift
//  CareLog
//
//  Main content view that routes based on authentication state and persona
//

import SwiftUI

/// Main content view for CareLog.
///
/// Routes to appropriate view based on:
/// - Authentication state
/// - User persona (patient, attendant, relative)
struct ContentView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        Group {
            if appState.isAuthenticated {
                AuthenticatedContentView()
            } else {
                // Login view will be implemented in T-012
                LoginPlaceholderView()
            }
        }
    }
}

/// View for authenticated users.
///
/// Routes to different dashboards based on user persona.
struct AuthenticatedContentView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        switch appState.currentPersona {
        case .patient:
            // Patient dashboard will be implemented in T-027
            DashboardPlaceholderView(title: "Patient Dashboard")
        case .attendant:
            // Attendant dashboard will be implemented in T-092
            DashboardPlaceholderView(title: "Attendant Dashboard")
        case .relative:
            // Relative dashboard will be implemented in T-070
            DashboardPlaceholderView(title: "Relative Dashboard")
        case .doctor:
            // Doctor uses web portal, this shouldn't happen
            Text("Please use the web portal")
        }
    }
}

/// Placeholder view for login.
struct LoginPlaceholderView: View {
    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "heart.circle.fill")
                .font(.system(size: 80))
                .foregroundColor(.blue)

            Text("CareLog")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("Health monitoring for you and your loved ones")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Spacer().frame(height: 40)

            // Login button placeholder
            Button(action: {}) {
                Text("Login")
                    .font(.headline)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.blue)
                    .cornerRadius(12)
            }
            .padding(.horizontal, 32)
        }
        .padding()
    }
}

/// Placeholder view for dashboards.
struct DashboardPlaceholderView: View {
    let title: String

    var body: some View {
        NavigationStack {
            VStack {
                Text("Dashboard content will be implemented")
                    .foregroundColor(.secondary)
            }
            .navigationTitle(title)
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(AppState())
}
