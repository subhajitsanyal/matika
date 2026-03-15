import SwiftUI

/// LLM Chat placeholder screen.
///
/// Simple "Coming Soon" screen with illustration.
/// No functionality in v1.
struct ChatPlaceholderView: View {
    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            // Chat icon
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 100))
                .foregroundColor(CareLogColors.chat.opacity(0.6))

            // Coming Soon text
            Text("Coming Soon")
                .font(.largeTitle)
                .fontWeight(.bold)
                .foregroundColor(CareLogColors.onSurface)

            // Description
            Text("Ask questions about your health data and get insights from our AI assistant.")
                .font(.body)
                .foregroundColor(CareLogColors.onSurfaceVariant)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            // Feature list
            VStack(alignment: .leading, spacing: 16) {
                FeatureItemView(text: "Understand your vital trends")
                FeatureItemView(text: "Get health tips and reminders")
                FeatureItemView(text: "Ask questions about readings")
            }
            .padding(.top, 16)

            Spacer()
        }
        .padding()
        .navigationTitle("Health Chat")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(CareLogColors.chat, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

struct FeatureItemView: View {
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundColor(CareLogColors.chat)
                .font(.title3)

            Text(text)
                .font(.body)
                .foregroundColor(CareLogColors.onSurface)
        }
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        ChatPlaceholderView()
    }
}
