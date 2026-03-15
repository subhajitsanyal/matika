//
//  MockVoicePlayer.swift
//  CareLogTests
//
//  Mock VoiceAcknowledgementPlayer for unit testing
//

import Foundation
@testable import CareLog

/// Protocol for VoiceAcknowledgementPlayer to enable mocking.
///
/// The actual VoiceAcknowledgementPlayer is a final class with private init,
/// so it cannot be subclassed. This protocol enables dependency injection
/// for testing when the production code is refactored to use it.
protocol VoicePlayerProtocol {
    func playSuccess(type: ObservationType)
    func playGenericSuccess()
    func playFailure()
    func playNoNetwork()
    func playUploadSuccess()
    func stop()
}

/// Mock VoiceAcknowledgementPlayer for unit testing.
/// All methods are no-ops that track calls for verification.
///
/// Note: To use this mock, the ViewModels would need to be refactored
/// to accept VoicePlayerProtocol instead of VoiceAcknowledgementPlayer directly.
/// Currently, the ViewModels use VoiceAcknowledgementPlayer.shared.
final class MockVoicePlayer: VoicePlayerProtocol {
    var playSuccessCallCount = 0
    var playFailureCallCount = 0
    var playGenericSuccessCallCount = 0
    var playNoNetworkCallCount = 0
    var playUploadSuccessCallCount = 0

    var lastPlayedSuccessType: ObservationType?

    init() {
        // No audio session setup needed
    }

    func playSuccess(type: ObservationType) {
        playSuccessCallCount += 1
        lastPlayedSuccessType = type
    }

    func playGenericSuccess() {
        playGenericSuccessCallCount += 1
    }

    func playFailure() {
        playFailureCallCount += 1
    }

    func playNoNetwork() {
        playNoNetworkCallCount += 1
    }

    func playUploadSuccess() {
        playUploadSuccessCallCount += 1
    }

    func stop() {
        // No-op
    }

    func reset() {
        playSuccessCallCount = 0
        playFailureCallCount = 0
        playGenericSuccessCallCount = 0
        playNoNetworkCallCount = 0
        playUploadSuccessCallCount = 0
        lastPlayedSuccessType = nil
    }
}
