package com.carelog.inference

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationStateMachineTest {

    // ── ConversationFsmState.fromServer mapping ────────────────

    @Test
    fun `fromServer maps known states case-insensitively`() {
        assertEquals(
            ConversationFsmState.PENDING_CONFIRMATION,
            ConversationFsmState.fromServer("PENDING_CONFIRMATION"),
        )
        assertEquals(
            ConversationFsmState.EXTRACTING,
            ConversationFsmState.fromServer("extracting"),
        )
    }

    @Test
    fun `fromServer falls through to UNKNOWN for null and unknown`() {
        assertEquals(ConversationFsmState.UNKNOWN, ConversationFsmState.fromServer(null))
        assertEquals(ConversationFsmState.UNKNOWN, ConversationFsmState.fromServer(""))
        assertEquals(
            ConversationFsmState.UNKNOWN,
            ConversationFsmState.fromServer("NEW_SERVER_STATE_ADDED_LATER"),
        )
    }

    // ── lifecycle: start → beginTurn → applyTurnResponse ───────

    @Test
    fun `start seeds session identity and transitions to CREATED`() {
        val sm = ConversationStateMachine()

        val sessionId = sm.start(
            patientCognitoSub = "patient-sub",
            actorCognitoSub = "actor-sub",
            languageTag = "hi-IN",
            sessionType = "patient_logging",
        )

        val s = sm.state.value
        assertEquals(sessionId, s.sessionId)
        assertEquals(ConversationFsmState.CREATED, s.fsmState)
        assertEquals(0, s.turnSequence)
        assertEquals("hi-IN", s.language)
        assertEquals("patient_logging", s.sessionType)
        assertEquals("patient-sub", s.patientCognitoSub)
        assertEquals("actor-sub", s.actorCognitoSub)
        assertFalse(s.isProcessingTurn)
    }

    @Test
    fun `start generates unique session IDs across sessions`() {
        val sm = ConversationStateMachine()
        val first = sm.start("p", "a", "en-IN", null)
        val second = sm.start("p", "a", "en-IN", null)
        assertNotNull(first)
        assertNotNull(second)
        assertFalse("session IDs should differ across start() calls", first == second)
    }

    @Test
    fun `beginTurn increments sequence and only sends sessionType on turn 1`() {
        val sm = ConversationStateMachine()
        sm.start("p", "a", "en-IN", "caregiver_onboarding")

        val first = sm.beginTurn()
        assertEquals(1, first.turnSequence)
        assertEquals("caregiver_onboarding", first.sessionType)
        assertTrue(sm.state.value.isProcessingTurn)

        // Simulate a successful round-trip clearing the in-flight flag.
        sm.applyTurnResponse(fakeTurnResponse(fsmState = "GREETING"))
        val second = sm.beginTurn()
        assertEquals(2, second.turnSequence)
        // sessionType is dropped on subsequent turns — server already
        // has it persisted, sending again would be misleading.
        assertNull(second.sessionType)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `beginTurn throws when called before start`() {
        ConversationStateMachine().beginTurn()
    }

    @Test
    fun `applyTurnResponse mirrors server fsm state and resets connectivity`() {
        val sm = ConversationStateMachine()
        sm.start("p", "a", "en-IN", null)
        sm.beginTurn()
        sm.connectivityChanged(ConnectivityState.DEGRADED)

        sm.applyTurnResponse(
            fakeTurnResponse(
                fsmState = "PENDING_CONFIRMATION",
                stillNeeded = listOf("blood_glucose", "weight"),
            ),
        )

        val s = sm.state.value
        assertEquals(ConversationFsmState.PENDING_CONFIRMATION, s.fsmState)
        assertEquals(listOf("blood_glucose", "weight"), s.stillNeeded)
        assertEquals(1, s.pendingConfirmation.size)
        assertFalse(s.isProcessingTurn)
        // A successful turn implies the link is up — connectivity is healed.
        assertEquals(ConnectivityState.HEALTHY, s.connectivity)
        assertNull(s.lastError)
    }

    @Test
    fun `applyTurnResponse with unrecognised fsm state falls back to UNKNOWN`() {
        val sm = ConversationStateMachine()
        sm.start("p", "a", "en-IN", null)
        sm.beginTurn()

        sm.applyTurnResponse(fakeTurnResponse(fsmState = "FUTURE_STATE_X"))

        assertEquals(ConversationFsmState.UNKNOWN, sm.state.value.fsmState)
    }

    @Test
    fun `applyTurnFailure surfaces error and clears in-flight without rolling back sequence`() {
        val sm = ConversationStateMachine()
        sm.start("p", "a", "en-IN", null)
        sm.beginTurn()
        val seqBefore = sm.state.value.turnSequence

        sm.applyTurnFailure(RuntimeException("network blew up"))

        val s = sm.state.value
        assertFalse(s.isProcessingTurn)
        assertEquals("network blew up", s.lastError)
        // We deliberately don't roll back the counter — the server may
        // have processed the turn even if we lost the response.
        assertEquals(seqBefore, s.turnSequence)
    }

    // ── pause / resume / connectivity / reset ──────────────────

    @Test
    fun `userPause and userResume do not clobber the FSM state`() {
        val sm = ConversationStateMachine()
        sm.start("p", "a", "en-IN", null)
        sm.beginTurn()
        sm.applyTurnResponse(fakeTurnResponse(fsmState = "EXTRACTING"))

        sm.userPause()
        assertEquals(ConversationFsmState.EXTRACTING, sm.state.value.fsmState)
        assertTrue(sm.state.value.isPausedByUser)

        sm.userResume()
        assertEquals(ConversationFsmState.EXTRACTING, sm.state.value.fsmState)
        assertFalse(sm.state.value.isPausedByUser)
    }

    @Test
    fun `connectivityChanged is independent of FSM state`() {
        val sm = ConversationStateMachine()
        sm.start("p", "a", "en-IN", null)
        sm.beginTurn()
        sm.applyTurnResponse(fakeTurnResponse(fsmState = "EXTRACTING"))

        sm.connectivityChanged(ConnectivityState.RECONNECTING)
        assertEquals(ConnectivityState.RECONNECTING, sm.state.value.connectivity)
        assertEquals(ConversationFsmState.EXTRACTING, sm.state.value.fsmState)
    }

    @Test
    fun `reset returns state to defaults`() {
        val sm = ConversationStateMachine()
        sm.start("p", "a", "en-IN", "patient_logging")
        sm.beginTurn()
        sm.applyTurnResponse(fakeTurnResponse(fsmState = "EXTRACTING"))

        sm.reset()

        val expected = ConversationState()
        // Use property-by-property equality to surface a future field
        // addition that defaults differently.
        assertSame(ConversationFsmState.IDLE, sm.state.value.fsmState)
        assertEquals(expected, sm.state.value)
    }
}
