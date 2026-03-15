import SwiftUI

/// Attendant dashboard view with identity context banner.
/// Same UX as patient dashboard but shows who is logged in.
struct AttendantDashboardView: View {
    @StateObject private var sessionManager = AttendantSessionManager.shared
    @State private var showSwitchAlert = false

    let onNavigateToVital: (VitalTypePatient) -> Void
    let onNavigateToUpload: () -> Void
    let onNavigateToNotes: () -> Void
    let onNavigateToHistory: () -> Void
    let onSwitchToPatient: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Attendant identity banner
                AttendantBanner(
                    attendantName: sessionManager.currentAttendant?.name ?? "Attendant",
                    onSwitchClick: { showSwitchAlert = true }
                )

                // Vital buttons grid
                ScrollView {
                    LazyVGrid(columns: [
                        GridItem(.flexible()),
                        GridItem(.flexible())
                    ], spacing: 12) {
                        ForEach(VitalTypePatient.allCases, id: \.self) { vitalType in
                            VitalActionButton(
                                title: vitalType.displayName,
                                icon: vitalType.iconName,
                                color: vitalType.color
                            ) {
                                onNavigateToVital(vitalType)
                            }
                        }

                        // Upload button
                        VitalActionButton(
                            title: "Upload",
                            icon: "arrow.up.doc",
                            color: CareLogColors.primary
                        ) {
                            onNavigateToUpload()
                        }

                        // Notes button (attendant-specific)
                        VitalActionButton(
                            title: "Add Note",
                            icon: "note.text.badge.plus",
                            color: CareLogColors.secondary
                        ) {
                            onNavigateToNotes()
                        }
                    }
                    .padding()
                }
            }
            .navigationTitle("Log Vitals")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack {
                        Button {
                            onNavigateToHistory()
                        } label: {
                            Image(systemName: "clock.arrow.circlepath")
                        }

                        Button {
                            showSwitchAlert = true
                        } label: {
                            Image(systemName: "person.crop.circle.badge.xmark")
                        }
                    }
                }
            }
            .alert("Switch to Patient Mode", isPresented: $showSwitchAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Switch") {
                    sessionManager.logoutAttendant()
                    onSwitchToPatient()
                }
            } message: {
                Text("Are you sure you want to switch back to patient mode? You can log in again as attendant later.")
            }
        }
    }
}

// MARK: - Attendant Banner

private struct AttendantBanner: View {
    let attendantName: String
    let onSwitchClick: () -> Void

    var body: some View {
        HStack {
            HStack(spacing: 8) {
                Image(systemName: "person.badge.shield.checkmark")
                    .foregroundColor(CareLogColors.primary)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Logged in as Attendant")
                        .font(.caption)
                        .foregroundColor(CareLogColors.primary)

                    Text(attendantName)
                        .font(.subheadline)
                        .fontWeight(.semibold)
                }
            }

            Spacer()

            Button("Switch to Patient") {
                onSwitchClick()
            }
            .font(.caption)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(CareLogColors.primary.opacity(0.1))
    }
}

// MARK: - Vital Action Button

private struct VitalActionButton: View {
    let title: String
    let icon: String
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 36))
                    .foregroundColor(color)

                Text(title)
                    .font(.headline)
                    .foregroundColor(.primary)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 120)
            .background(color.opacity(0.1))
            .cornerRadius(16)
        }
    }
}

// MARK: - Vital Type

enum VitalTypePatient: String, CaseIterable {
    case bloodPressure
    case glucose
    case temperature
    case weight
    case pulse
    case spo2

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

    var color: Color {
        switch self {
        case .bloodPressure: return CareLogColors.bloodPressure
        case .glucose: return CareLogColors.glucose
        case .temperature: return CareLogColors.temperature
        case .weight: return CareLogColors.weight
        case .pulse: return CareLogColors.pulse
        case .spo2: return CareLogColors.spO2
        }
    }
}

// MARK: - Preview

#Preview {
    AttendantDashboardView(
        onNavigateToVital: { _ in },
        onNavigateToUpload: {},
        onNavigateToNotes: {},
        onNavigateToHistory: {},
        onSwitchToPatient: {}
    )
}
