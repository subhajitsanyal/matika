import SwiftUI

/// Audit log viewer for relatives.
/// Shows chronological activity log with filtering capabilities.
struct AuditLogView: View {
    @StateObject private var viewModel = AuditLogViewModel()
    @State private var showFilterSheet = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Active filters bar
                if viewModel.hasActiveFilters {
                    ActiveFiltersBar(
                        selectedActor: viewModel.selectedActor,
                        selectedAction: viewModel.selectedAction,
                        selectedResourceType: viewModel.selectedResourceType,
                        onClearAll: { viewModel.clearFilters() }
                    )
                }

                // Content
                if viewModel.isLoading && viewModel.logs.isEmpty {
                    Spacer()
                    ProgressView("Loading audit log...")
                    Spacer()
                } else if viewModel.logs.isEmpty {
                    Spacer()
                    EmptyAuditLogView()
                    Spacer()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(viewModel.logs) { entry in
                                AuditLogCard(entry: entry)
                            }

                            // Load more
                            if viewModel.hasMore {
                                Button(action: { viewModel.loadMore() }) {
                                    if viewModel.isLoading {
                                        ProgressView()
                                            .frame(maxWidth: .infinity)
                                            .padding()
                                    } else {
                                        Text("Load More")
                                            .frame(maxWidth: .infinity)
                                            .padding()
                                    }
                                }
                                .foregroundColor(CareLogColors.primary)
                            }
                        }
                        .padding()
                    }
                    .refreshable {
                        await viewModel.refresh()
                    }
                }
            }
            .navigationTitle("Activity Log")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showFilterSheet = true
                    } label: {
                        Image(systemName: viewModel.hasActiveFilters ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                    }
                }
            }
            .sheet(isPresented: $showFilterSheet) {
                FilterSheet(viewModel: viewModel)
            }
            .onAppear {
                viewModel.loadLogs()
            }
        }
    }
}

// MARK: - Active Filters Bar

private struct ActiveFiltersBar: View {
    let selectedActor: AuditActor?
    let selectedAction: String?
    let selectedResourceType: String?
    let onClearAll: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if let actor = selectedActor {
                    FilterChipView(
                        label: "Actor: \(actor.name)",
                        onRemove: nil
                    )
                }

                if let action = selectedAction {
                    FilterChipView(
                        label: "Action: \(action)",
                        onRemove: nil
                    )
                }

                if let resourceType = selectedResourceType {
                    FilterChipView(
                        label: "Type: \(resourceType)",
                        onRemove: nil
                    )
                }

                Button("Clear All") {
                    onClearAll()
                }
                .font(.caption)
                .foregroundColor(CareLogColors.primary)
            }
            .padding(.horizontal)
        }
        .padding(.vertical, 8)
        .background(Color(.secondarySystemBackground))
    }
}

private struct FilterChipView: View {
    let label: String
    let onRemove: (() -> Void)?

    var body: some View {
        HStack(spacing: 4) {
            Text(label)
                .font(.caption)

            if let onRemove = onRemove {
                Button(action: onRemove) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.caption)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(CareLogColors.primary.opacity(0.1))
        .foregroundColor(CareLogColors.primary)
        .cornerRadius(16)
    }
}

// MARK: - Audit Log Card

private struct AuditLogCard: View {
    let entry: AuditLogEntry

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Action icon
            Image(systemName: entry.actionIcon)
                .font(.title2)
                .foregroundColor(entry.actionColor)
                .frame(width: 44, height: 44)
                .background(entry.actionColor.opacity(0.1))
                .cornerRadius(22)

            VStack(alignment: .leading, spacing: 4) {
                // Action description
                Text(entry.actionDescription)
                    .font(.subheadline)
                    .fontWeight(.medium)

                // Actor info
                HStack(spacing: 6) {
                    Text(entry.actorName)
                        .font(.caption)
                        .foregroundColor(.secondary)

                    RoleBadge(role: entry.actorRole)
                }

                // Timestamp
                Text(entry.formattedTimestamp)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            Spacer()
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 2, x: 0, y: 1)
    }
}

private struct RoleBadge: View {
    let role: String

    var body: some View {
        Text(role.capitalized)
            .font(.caption2)
            .fontWeight(.medium)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(roleColor.opacity(0.1))
            .foregroundColor(roleColor)
            .cornerRadius(4)
    }

    private var roleColor: Color {
        switch role.lowercased() {
        case "doctor": return CareLogColors.doctor
        case "relative": return CareLogColors.relative
        case "attendant": return CareLogColors.attendant
        case "patient": return CareLogColors.patient
        default: return .gray
        }
    }
}

// MARK: - Empty State

private struct EmptyAuditLogView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            Text("No Activity Yet")
                .font(.headline)

            Text("Activity will appear here as vitals are logged and changes are made.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
    }
}

// MARK: - Filter Sheet

private struct FilterSheet: View {
    @ObservedObject var viewModel: AuditLogViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                // Actor filter
                Section("Actor") {
                    Picker("Select Actor", selection: $viewModel.selectedActor) {
                        Text("All").tag(nil as AuditActor?)
                        ForEach(viewModel.availableActors) { actor in
                            Text("\(actor.name) (\(actor.role.capitalized))")
                                .tag(actor as AuditActor?)
                        }
                    }
                    .pickerStyle(.menu)
                }

                // Action filter
                Section("Action Type") {
                    Picker("Select Action", selection: $viewModel.selectedAction) {
                        Text("All").tag(nil as String?)
                        ForEach(viewModel.availableActions, id: \.self) { action in
                            Text(action).tag(action as String?)
                        }
                    }
                    .pickerStyle(.menu)
                }

                // Resource type filter
                Section("Resource Type") {
                    Picker("Select Type", selection: $viewModel.selectedResourceType) {
                        Text("All").tag(nil as String?)
                        ForEach(viewModel.availableResourceTypes, id: \.self) { type in
                            Text(type).tag(type as String?)
                        }
                    }
                    .pickerStyle(.menu)
                }
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Reset") {
                        viewModel.clearFilters()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") {
                        viewModel.applyFilters()
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - Models

struct AuditLogEntry: Identifiable {
    let id: String
    let action: String
    let resourceType: String
    let resourceId: String?
    let actorId: String
    let actorName: String
    let actorRole: String
    let details: [String: Any]?
    let timestamp: Date

    var actionDescription: String {
        let actionVerb: String
        switch action.uppercased() {
        case "CREATE": actionVerb = "Created"
        case "UPDATE": actionVerb = "Updated"
        case "DELETE": actionVerb = "Deleted"
        case "READ": actionVerb = "Viewed"
        case "LOGIN": return "Logged in"
        case "LOGOUT": return "Logged out"
        default: actionVerb = action
        }

        return "\(actionVerb) \(resourceType)"
    }

    var actionIcon: String {
        switch action.uppercased() {
        case "CREATE": return "plus.circle.fill"
        case "UPDATE": return "pencil.circle.fill"
        case "DELETE": return "trash.circle.fill"
        case "READ": return "eye.circle.fill"
        case "LOGIN": return "arrow.right.circle.fill"
        case "LOGOUT": return "arrow.left.circle.fill"
        default: return "circle.fill"
        }
    }

    var actionColor: Color {
        switch action.uppercased() {
        case "CREATE": return CareLogColors.success
        case "UPDATE": return CareLogColors.primary
        case "DELETE": return CareLogColors.error
        case "READ": return .blue
        case "LOGIN", "LOGOUT": return .purple
        default: return .gray
        }
    }

    var formattedTimestamp: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: timestamp, relativeTo: Date())
    }
}

struct AuditActor: Identifiable, Hashable {
    let id: String
    let name: String
    let role: String
}

// MARK: - ViewModel

@MainActor
class AuditLogViewModel: ObservableObject {
    @Published var logs: [AuditLogEntry] = []
    @Published var isLoading = false
    @Published var hasMore = true
    @Published var error: String?

    // Filters
    @Published var selectedActor: AuditActor?
    @Published var selectedAction: String?
    @Published var selectedResourceType: String?

    // Available filter options
    @Published var availableActors: [AuditActor] = []
    @Published var availableActions: [String] = ["CREATE", "UPDATE", "DELETE", "READ", "LOGIN", "LOGOUT"]
    @Published var availableResourceTypes: [String] = [
        "Observation", "DocumentReference", "Threshold",
        "ReminderConfig", "CarePlan", "Patient", "User", "Session"
    ]

    private var currentOffset = 0
    private let pageSize = 20

    var hasActiveFilters: Bool {
        selectedActor != nil || selectedAction != nil || selectedResourceType != nil
    }

    func loadLogs() {
        guard !isLoading else { return }

        isLoading = true
        currentOffset = 0

        Task {
            do {
                let result = try await fetchAuditLogs(offset: 0)
                logs = result.logs
                availableActors = result.actors
                hasMore = result.logs.count >= pageSize
                currentOffset = result.logs.count
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }

    func loadMore() {
        guard !isLoading, hasMore else { return }

        isLoading = true

        Task {
            do {
                let result = try await fetchAuditLogs(offset: currentOffset)
                logs.append(contentsOf: result.logs)
                hasMore = result.logs.count >= pageSize
                currentOffset += result.logs.count
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }

    func refresh() async {
        currentOffset = 0

        do {
            let result = try await fetchAuditLogs(offset: 0)
            logs = result.logs
            availableActors = result.actors
            hasMore = result.logs.count >= pageSize
            currentOffset = result.logs.count
        } catch {
            self.error = error.localizedDescription
        }
    }

    func applyFilters() {
        loadLogs()
    }

    func clearFilters() {
        selectedActor = nil
        selectedAction = nil
        selectedResourceType = nil
        loadLogs()
    }

    private func fetchAuditLogs(offset: Int) async throws -> (logs: [AuditLogEntry], actors: [AuditActor]) {
        // Build query parameters
        var queryItems: [URLQueryItem] = [
            URLQueryItem(name: "limit", value: String(pageSize)),
            URLQueryItem(name: "offset", value: String(offset))
        ]

        if let actor = selectedActor {
            queryItems.append(URLQueryItem(name: "actorId", value: actor.id))
        }

        if let action = selectedAction {
            queryItems.append(URLQueryItem(name: "action", value: action))
        }

        if let resourceType = selectedResourceType {
            queryItems.append(URLQueryItem(name: "resourceType", value: resourceType))
        }

        // Note: In production, make actual API call
        // For now, return mock data
        try await Task.sleep(nanoseconds: 500_000_000)

        let mockLogs: [AuditLogEntry] = [
            AuditLogEntry(
                id: "1",
                action: "CREATE",
                resourceType: "Observation",
                resourceId: "obs-123",
                actorId: "user-1",
                actorName: "John Attendant",
                actorRole: "attendant",
                details: ["vitalType": "bloodPressure"],
                timestamp: Date().addingTimeInterval(-3600)
            ),
            AuditLogEntry(
                id: "2",
                action: "UPDATE",
                resourceType: "Threshold",
                resourceId: "thr-456",
                actorId: "user-2",
                actorName: "Dr. Smith",
                actorRole: "doctor",
                details: ["vitalType": "glucose"],
                timestamp: Date().addingTimeInterval(-7200)
            ),
            AuditLogEntry(
                id: "3",
                action: "LOGIN",
                resourceType: "Session",
                resourceId: nil,
                actorId: "user-3",
                actorName: "Mary Relative",
                actorRole: "relative",
                details: nil,
                timestamp: Date().addingTimeInterval(-86400)
            )
        ]

        let mockActors: [AuditActor] = [
            AuditActor(id: "user-1", name: "John Attendant", role: "attendant"),
            AuditActor(id: "user-2", name: "Dr. Smith", role: "doctor"),
            AuditActor(id: "user-3", name: "Mary Relative", role: "relative")
        ]

        return (mockLogs, mockActors)
    }
}

// MARK: - Colors Extension

extension CareLogColors {
    static let doctor = Color.blue
    static let relative = Color.purple
    static let attendant = Color.orange
    static let patient = Color.green
}

// MARK: - Preview

#Preview {
    AuditLogView()
}
