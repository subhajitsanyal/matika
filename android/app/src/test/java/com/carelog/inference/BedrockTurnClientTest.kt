package com.carelog.inference

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BedrockTurnClientTest {

    @Test
    fun `submitTurn maps domain naming to wire field names`() = runTest {
        val api = FakeMatikaCloudApi(turnHandler = { fakeTurnResponse() })
        val client = BedrockTurnClient(api)

        val result = client.submitTurn(
            sessionId = "11111111-1111-1111-1111-111111111111",
            patientCognitoSub = "patient-cognito-sub",
            actorCognitoSub = "actor-cognito-sub",
            transcript = "BP is 130 over 85",
            languageTag = "en-IN",
            turnSequence = 1,
            sessionType = "patient_logging",
        )

        assertTrue("call should succeed", result.isSuccess)
        assertEquals(1, api.recordedTurnRequests.size)
        val sent = api.recordedTurnRequests.single()
        assertEquals("11111111-1111-1111-1111-111111111111", sent.sessionId)
        // Wire field is `patientId`, but it carries the Cognito sub.
        assertEquals("patient-cognito-sub", sent.patientId)
        assertEquals("actor-cognito-sub", sent.actorCognitoSub)
        assertEquals("BP is 130 over 85", sent.transcript)
        assertEquals("en-IN", sent.language)
        assertEquals(1, sent.turnSequence)
        assertEquals("patient_logging", sent.sessionType)
    }

    @Test
    fun `submitTurn omits sessionType when null`() = runTest {
        val api = FakeMatikaCloudApi(turnHandler = { fakeTurnResponse() })
        val client = BedrockTurnClient(api)

        client.submitTurn(
            sessionId = "s",
            patientCognitoSub = "p",
            actorCognitoSub = "a",
            transcript = "next turn",
            languageTag = "en-IN",
            turnSequence = 5,
            sessionType = null,
        )

        assertNull(api.recordedTurnRequests.single().sessionType)
    }

    @Test
    fun `submitTurn returns Result_failure on api exception`() = runTest {
        val boom = RuntimeException("dev API gateway 503")
        val api = FakeMatikaCloudApi(turnHandler = { throw boom })
        val client = BedrockTurnClient(api)

        val result = client.submitTurn(
            sessionId = "s",
            patientCognitoSub = "p",
            actorCognitoSub = "a",
            transcript = "x",
            languageTag = "en-IN",
            turnSequence = 1,
        )

        assertTrue(result.isFailure)
        assertEquals(boom, result.exceptionOrNull())
    }

    @Test
    fun `submitTurn returns Result_success carrying the api response`() = runTest {
        val canned = fakeTurnResponse(responseText = "hello world")
        val api = FakeMatikaCloudApi(turnHandler = { canned })
        val client = BedrockTurnClient(api)

        val result = client.submitTurn(
            sessionId = "s",
            patientCognitoSub = "p",
            actorCognitoSub = "a",
            transcript = "hi",
            languageTag = "en-IN",
            turnSequence = 1,
        )

        assertTrue(result.isSuccess)
        val response = result.getOrNull()
        assertNotNull(response)
        assertEquals("hello world", response!!.responseText)
    }
}
