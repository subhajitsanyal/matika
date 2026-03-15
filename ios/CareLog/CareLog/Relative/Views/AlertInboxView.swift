import SwiftUI

/// Alert inbox view showing all alerts for the linked patient.
struct AlertInboxView: View {
    @StateObject private var viewModel = AlertInboxViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                if viewModel.isLoading && viewModel.alerts.isEmpty {
                    ProgressView("Loading alerts...")
                } else if let error = viewModel.error, viewModel.alerts.isEmpty {
                    ErrorView(message: error) {
                        viewModel.loadAlerts()
                    }
                } else if viewModel.alerts.isEmpty {
                    EmptyAlertsView(showUnreadOnly: viewModel.showUnreadOnly)
                } else {
                    List {
                        ForEach(viewModel.alerts) { alert in
                            AlertRow(
                                alert: alert,
                                onTap: {
                                    if !alert.read {
                                        viewModel.markAsRead(alertId: alert.id)
                                    }
                                }
                            )
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    viewModel.deleteAlert(alertId: alert.id)
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }

                                if !alert.read {
                                    Button {
                                        viewModel.markAsRead(alertId: alert.id)
                                    } label: {
                                        Label("Read", systemImage: "checkmark")
                                    }
                                    .tint(CareLogColors.primary)
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                    .refreshable {
                        await viewModel.refreshAlerts()
                    }
                }
            }
            .navigationTitle("Alerts")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Done") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button {
                            viewModel.toggleFilter()
                        } label: {
                            Label(
                                viewModel.showUnreadOnly ? "Show All" : "Show Unread Only",
                                systemImage: viewModel.showUnreadOnly ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"
                            )
                        }

                        if viewModel.unreadCount > 0 {
                            Button {
                                viewModel.markAllAsRead()
                            } label: {
                                Label("Mark All as Read", systemImage: "checkmark.circle")
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .task {
                viewModel.loadAlerts()
            }
        }
    }
}

// MARK: - Alert Row

private struct AlertRow: View {
    let alert: Alert
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: 12) {
                // Alert icon
                ZStack {
                    Circle()
                        .fill(alertColor.opacity(0.1))
                        .frame(width: 44, height: 44)

                    Image(systemName: alertIcon)
                        .foregroundColor(alertColor)
                }

                // Content
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(alertTitle)
                            .font(.subheadline)
                            .fontWeight(alert.read ? .regular : .semibold)
                            .foregroundColor(.primary)

                        Spacer()

                        if !alert.read {
                            Circle()
                                .fill(CareLogColors.primary)
                                .frame(width: 8, height: 8)
                        }
                    }

                    Text(alert.message)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .lineLimit(2)

                    Text(formattedTimestamp)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(alert.read ? Color.clear : CareLogColors.primary.opacity(0.03))
    }

    private var alertColor: Color {
        switch alert.alertType {
        case .thresholdBreach: return CareLogColors.error
        case .reminderLapse: return CareLogColors.warning
        case .system: return CareLogColors.primary
        }
    }

    private var alertIcon: String {
        switch alert.alertType {
        case .thresholdBreach: return "exclamationmark.triangle.fill"
        case .reminderLapse: return "clock.fill"
        case .system: return "info.circle.fill"
        }
    }

    private var alertTitle: String {
        switch alert.alertType {
        case .thresholdBreach:
            if let vitalType = alert.vitalType {
                return "\(vitalType.displayName) Alert"
            }
            return "Threshold Alert"
        case .reminderLapse:
            if let vitalType = alert.vitalType {
                return "\(vitalType.displayName) Reminder"
            }
            return "Reminder Lapse"
        case .system:
            return "System Notification"
        }
    }

    private var formattedTimestamp: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, h:mm a"
        return formatter.string(from: alert.timestamp)
    }
}

// MARK: - Empty Alerts View

private struct EmptyAlertsView: View {
    let showUnreadOnly: Bool

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "bell.slash")
                .font(.system(size: 64))
                .foregroundColor(.secondary.opacity(0.5))

            Text(showUnreadOnly ? "No unread alerts" : "No alerts yet")
                .font(.title3)
                .fontWeight(.medium)

            Text(showUnreadOnly
                ? "All alerts have been read"
                : "Alerts will appear here when vital readings are outside thresholds or reminders are missed")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
    }
}

// MARK: - Error View

private struct ErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            Text(message)
                .font(.headline)
                .multilineTextAlignment(.center)

            Button("Retry", action: onRetry)
                .buttonStyle(.borderedProminent)
        }
        .padding(32)
    }
}

// MARK: - Preview

#Preview {
    AlertInboxView()
}
