import SwiftUI

/// DPDP Consent view shown during onboarding.
/// User must accept to proceed with registration.
struct ConsentView: View {
    @StateObject private var viewModel = ConsentViewModel()
    @Environment(\.dismiss) private var dismiss

    let onConsentAccepted: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Scrollable consent text
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if viewModel.isLoading {
                            HStack {
                                Spacer()
                                ProgressView()
                                Spacer()
                            }
                            .padding(.top, 40)
                        } else {
                            Text("CareLog Privacy Consent")
                                .font(.title2)
                                .fontWeight(.bold)

                            Text("Version \(viewModel.consentVersion)")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            Text(viewModel.consentText)
                                .font(.body)
                        }
                    }
                    .padding()
                }

                Divider()

                // Consent checkbox and button
                VStack(spacing: 16) {
                    // Error message
                    if let error = viewModel.error {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                    }

                    // Checkbox
                    Button(action: {
                        viewModel.termsAccepted.toggle()
                    }) {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: viewModel.termsAccepted ? "checkmark.square.fill" : "square")
                                .font(.title2)
                                .foregroundColor(viewModel.termsAccepted ? CareLogColors.primary : .secondary)

                            Text("I have read, understood, and agree to the privacy consent and data processing terms above.")
                                .font(.subheadline)
                                .foregroundColor(.primary)
                                .multilineTextAlignment(.leading)
                        }
                    }
                    .disabled(viewModel.isLoading || viewModel.isSubmitting)

                    // Accept button
                    Button(action: {
                        viewModel.acceptConsent {
                            onConsentAccepted()
                        }
                    }) {
                        if viewModel.isSubmitting {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                .frame(maxWidth: .infinity)
                                .frame(height: 50)
                        } else {
                            Text("Accept and Continue")
                                .fontWeight(.semibold)
                                .frame(maxWidth: .infinity)
                                .frame(height: 50)
                        }
                    }
                    .background(
                        viewModel.termsAccepted && !viewModel.isSubmitting
                            ? CareLogColors.primary
                            : Color.gray
                    )
                    .foregroundColor(.white)
                    .cornerRadius(10)
                    .disabled(!viewModel.termsAccepted || viewModel.isSubmitting)

                    // Cancel button
                    Button("Cancel Registration") {
                        dismiss()
                    }
                    .foregroundColor(.secondary)
                }
                .padding()
            }
            .navigationTitle("Privacy Consent")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .onAppear {
                viewModel.loadConsentText()
            }
        }
    }
}

// MARK: - ViewModel

@MainActor
class ConsentViewModel: ObservableObject {
    @Published var isLoading = true
    @Published var isSubmitting = false
    @Published var consentText = ""
    @Published var consentVersion = ""
    @Published var consentHash = ""
    @Published var termsAccepted = false
    @Published var error: String?

    private let apiEndpoint = ProcessInfo.processInfo.environment["API_ENDPOINT"] ?? ""

    func loadConsentText() {
        Task {
            isLoading = true
            error = nil

            do {
                let url = URL(string: "\(apiEndpoint)/consent/text")!
                let (data, _) = try await URLSession.shared.data(from: url)

                let response = try JSONDecoder().decode(ConsentTextResponse.self, from: data)

                consentText = response.text
                consentVersion = response.version
                consentHash = response.hash
            } catch {
                self.error = error.localizedDescription
            }

            isLoading = false
        }
    }

    func acceptConsent(onSuccess: @escaping () -> Void) {
        guard termsAccepted else { return }

        Task {
            isSubmitting = true
            error = nil

            do {
                let url = URL(string: "\(apiEndpoint)/consent")!
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")

                let body = ConsentAcceptRequest(
                    version: consentVersion,
                    textHash: consentHash,
                    acceptedTerms: true
                )
                request.httpBody = try JSONEncoder().encode(body)

                let (_, response) = try await URLSession.shared.data(for: request)

                if let httpResponse = response as? HTTPURLResponse,
                   httpResponse.statusCode == 201 {
                    onSuccess()
                } else {
                    self.error = "Failed to record consent"
                }
            } catch {
                self.error = error.localizedDescription
            }

            isSubmitting = false
        }
    }
}

// MARK: - Models

struct ConsentTextResponse: Codable {
    let version: String
    let text: String
    let hash: String
    let lastUpdated: String
}

struct ConsentAcceptRequest: Codable {
    let version: String
    let textHash: String
    let acceptedTerms: Bool
}

// MARK: - Preview

#Preview {
    ConsentView(onConsentAccepted: {})
}
