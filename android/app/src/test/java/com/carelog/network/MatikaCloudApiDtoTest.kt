package com.carelog.network

import com.google.gson.Gson
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests that pin the wire format of the v2 Matika cloud API DTOs.
 *
 * The fixtures here are sourced directly from the backend code:
 *  - `backend/lambdas/bedrock-router/src/handler.ts` (TurnRequest /
 *    TurnResponseBody)
 *  - `backend/lambdas/photo-presign/src/handler.ts` (PresignRequest /
 *    PresignResponse)
 *  - `backend/lambdas/bedrock-vision/src/handler.ts`
 *    (PhotoExtractRequest / PhotoExtractResponseBody)
 *  - `backend/lambdas/health-check/src/handler.ts` (HealthBody)
 *
 * If a backend type changes, this test should fail loudly before the
 * client hits the dev API and gets a deserialization error at runtime.
 */
class MatikaCloudApiDtoTest {

    private val gson = Gson()

    // ── /conversation/turn ──────────────────────────────────────

    @Test
    fun `TurnRequest serializes camelCase fields exactly as backend expects`() {
        val request = TurnRequest(
            sessionId = "11111111-1111-1111-1111-111111111111",
            patientId = "cognito-sub-abc",
            transcript = "BP is one thirty over eighty five",
            language = "en-IN",
            turnSequence = 3,
            sessionType = SessionType.PATIENT_LOGGING,
            actorCognitoSub = "cognito-sub-abc",
            clientHints = ClientHints(preferStreaming = false, deviceLatencyEstimateMs = 80),
        )

        val json = JsonParser.parseString(gson.toJson(request)).asJsonObject

        assertEquals("11111111-1111-1111-1111-111111111111", json.get("sessionId").asString)
        assertEquals("cognito-sub-abc", json.get("patientId").asString)
        assertEquals("BP is one thirty over eighty five", json.get("transcript").asString)
        assertEquals("en-IN", json.get("language").asString)
        assertEquals(3, json.get("turnSequence").asInt)
        assertEquals("patient_logging", json.get("sessionType").asString)
        assertEquals("cognito-sub-abc", json.get("actorCognitoSub").asString)
        val hints = json.getAsJsonObject("clientHints")
        assertEquals(false, hints.get("preferStreaming").asBoolean)
        assertEquals(80, hints.get("deviceLatencyEstimateMs").asInt)
    }

    @Test
    fun `TurnRequest omits optional fields when null`() {
        val minimal = TurnRequest(
            sessionId = "s",
            patientId = "p",
            transcript = "t",
            language = "en-IN",
            turnSequence = 1,
        )

        val json = JsonParser.parseString(gson.toJson(minimal)).asJsonObject

        assertTrue(json.has("sessionId"))
        assertTrue(json.has("patientId"))
        // Default Gson drops nulls — backend treats absent and null
        // identically for these optional fields.
        assertNull(json.get("sessionType"))
        assertNull(json.get("actorCognitoSub"))
        assertNull(json.get("clientHints"))
    }

    @Test
    fun `TurnResponse parses a minimal patient_logging response`() {
        // Synthesized to match the contract in handler.ts:82-124.
        val json = """
        {
          "responseText": "I heard one thirty over eighty five. Is that correct?",
          "ttsHints": { "language": "en-IN", "spellOutNumbers": false },
          "extractedValues": [
            {
              "parameter": "blood_pressure_systolic",
              "value": 130,
              "unit": "mmHg",
              "loincCode": "8480-6",
              "status": "pending_confirmation",
              "confidence": 0.94
            }
          ],
          "sessionState": {
            "capturedThisSession": [],
            "pendingConfirmation": [],
            "stillNeeded": ["blood_glucose"],
            "fsmState": "PENDING_CONFIRMATION"
          },
          "actions": [],
          "telemetry": {
            "tier": "T2",
            "model": "claude-haiku-4-5",
            "latencyMs": 612,
            "inputTokens": 1840,
            "cachedInputTokens": 1420,
            "outputTokens": 28,
            "guardrailBlocked": false,
            "inferenceRegion": "ap-southeast-1",
            "escalationReason": null,
            "softCapReached": false
          }
        }
        """.trimIndent()

        val response = gson.fromJson(json, TurnResponse::class.java)

        assertEquals("I heard one thirty over eighty five. Is that correct?", response.responseText)
        assertEquals("en-IN", response.ttsHints.language)
        assertEquals(false, response.ttsHints.spellOutNumbers)
        assertEquals(1, response.extractedValues.size)
        val ev = response.extractedValues[0]
        assertEquals("blood_pressure_systolic", ev.parameter)
        assertEquals(130.0, ev.value, 0.0)
        assertEquals("8480-6", ev.loincCode)
        assertEquals(ExtractedValueStatus.PENDING_CONFIRMATION, ev.status)
        assertEquals("PENDING_CONFIRMATION", response.sessionState.fsmState)
        assertEquals(listOf("blood_glucose"), response.sessionState.stillNeeded)
        assertEquals("T2", response.telemetry.tier)
        assertEquals(1420, response.telemetry.cachedInputTokens)
        assertNull(response.telemetry.escalationReason)
        assertNull(response.protocol)
        assertNull(response.observations)
    }

    @Test
    fun `TurnResponse parses optional protocol and observations blocks when present`() {
        val json = """
        {
          "responseText": "Thanks, that's everything.",
          "ttsHints": { "language": "en-IN", "spellOutNumbers": false },
          "extractedValues": [],
          "sessionState": {
            "capturedThisSession": [],
            "pendingConfirmation": [],
            "stillNeeded": [],
            "fsmState": "COMPLETE"
          },
          "actions": [{ "type": "complete_session", "reason": "all_required_parameters_captured" }],
          "telemetry": {
            "tier": "T3",
            "model": "claude-sonnet-4-x",
            "latencyMs": 1842,
            "inputTokens": 2100,
            "cachedInputTokens": 1420,
            "outputTokens": 85,
            "guardrailBlocked": false,
            "inferenceRegion": "ap-southeast-1",
            "escalationReason": "caregiver_protocol_design",
            "softCapReached": false
          },
          "protocol": {
            "extracted": true,
            "parametersConfigured": 4,
            "topicsConfigured": 2,
            "topicsSkipped": ["dietary_restrictions"],
            "error": null
          },
          "observations": {
            "written": 2,
            "failed": 0,
            "s3Keys": ["observations/sub/2026/05/03/abc.json"],
            "errors": []
          }
        }
        """.trimIndent()

        val response = gson.fromJson(json, TurnResponse::class.java)

        assertNotNull(response.protocol)
        assertEquals(true, response.protocol!!.extracted)
        assertEquals(4, response.protocol!!.parametersConfigured)
        assertEquals(listOf("dietary_restrictions"), response.protocol!!.topicsSkipped)
        assertNull(response.protocol!!.error)

        assertNotNull(response.observations)
        assertEquals(2, response.observations!!.written)
        assertEquals(1, response.observations!!.s3Keys.size)
        assertEquals(TurnActionType.COMPLETE_SESSION, response.actions[0].type)
        assertEquals("caregiver_protocol_design", response.telemetry.escalationReason)
    }

    // ── /conversation/photo-presign ─────────────────────────────

    @Test
    fun `PhotoPresignRequest defaults contentType absent`() {
        val request = PhotoPresignRequest(patientId = "p", sessionId = "s")
        val json = JsonParser.parseString(gson.toJson(request)).asJsonObject

        assertEquals("p", json.get("patientId").asString)
        assertEquals("s", json.get("sessionId").asString)
        assertNull(json.get("contentType"))
    }

    @Test
    fun `PhotoPresignResponse parses required headers as map`() {
        val json = """
        {
          "uploadUrl": "https://bucket.s3.ap-south-1.amazonaws.com/key?X-Amz-...",
          "s3Key": "interactions/sub/2026/05/03/sess/photos/uuid.jpg",
          "requiredHeaders": {
            "Content-Type": "image/jpeg",
            "x-amz-server-side-encryption": "aws:kms"
          },
          "expiresIn": 300
        }
        """.trimIndent()

        val response = gson.fromJson(json, PhotoPresignResponse::class.java)

        assertEquals(300, response.expiresIn)
        assertEquals("image/jpeg", response.requiredHeaders["Content-Type"])
        assertEquals("aws:kms", response.requiredHeaders["x-amz-server-side-encryption"])
    }

    // ── /conversation/photo-extract ─────────────────────────────

    @Test
    fun `PhotoExtractRequest serializes localOcrAttempt block`() {
        val request = PhotoExtractRequest(
            sessionId = "s",
            patientId = "p",
            photoS3Key = "interactions/p/2026/05/03/s/photos/abc.jpg",
            expectedParameter = "blood_glucose",
            expectedUnit = "mg/dL",
            deviceHint = "glucometer",
            localOcrAttempt = LocalOcrAttempt(rawText = "142", confidence = 0.62),
        )

        val json = JsonParser.parseString(gson.toJson(request)).asJsonObject

        assertEquals("blood_glucose", json.get("expectedParameter").asString)
        assertEquals("glucometer", json.get("deviceHint").asString)
        val ocr = json.getAsJsonObject("localOcrAttempt")
        assertEquals("142", ocr.get("rawText").asString)
        assertEquals(0.62, ocr.get("confidence").asDouble, 0.0001)
    }

    @Test
    fun `PhotoExtractResponse parses Haiku-only telemetry shape`() {
        val json = """
        {
          "extractedValue": {
            "parameter": "blood_glucose",
            "value": 142,
            "unit": "mg/dL",
            "loincCode": "2339-0",
            "confidence": 0.96,
            "source": "claude-haiku-4-5-vision"
          },
          "telemetry": {
            "tier": "T2_VISION",
            "haikuLatencyMs": 720,
            "sonnetUsed": false,
            "inferenceRegion": "ap-southeast-1"
          }
        }
        """.trimIndent()

        val response = gson.fromJson(json, PhotoExtractResponse::class.java)

        assertEquals(142.0, response.extractedValue.value, 0.0)
        assertEquals("2339-0", response.extractedValue.loincCode)
        assertEquals("T2_VISION", response.telemetry.tier)
        assertEquals(720L, response.telemetry.haikuLatencyMs)
        assertNull(response.telemetry.sonnetLatencyMs)
        assertEquals(false, response.telemetry.sonnetUsed)
    }

    // ── /health ────────────────────────────────────────────────

    @Test
    fun `MatikaHealthResponse parses snake_case checks fields via SerializedName`() {
        val json = """
        {
          "status": "healthy",
          "checks": {
            "rds": "up",
            "bedrock": "up",
            "bedrock_inference_region": "ap-southeast-1",
            "s3": "up",
            "lambda_warm": true
          },
          "timestamp": "2026-05-03T12:00:00Z"
        }
        """.trimIndent()

        val response = gson.fromJson(json, MatikaHealthResponse::class.java)

        assertEquals(MatikaHealthStatus.HEALTHY, response.status)
        assertEquals("up", response.checks.rds)
        assertEquals("ap-southeast-1", response.checks.bedrockInferenceRegion)
        assertEquals(true, response.checks.lambdaWarm)
        assertNull(response.errors)
    }

    @Test
    fun `MatikaHealthResponse parses degraded shape with errors map and null inference region`() {
        val json = """
        {
          "status": "degraded",
          "checks": {
            "rds": "up",
            "bedrock": "down",
            "bedrock_inference_region": null,
            "s3": "up",
            "lambda_warm": true
          },
          "errors": { "bedrock": "AccessDenied" },
          "timestamp": "2026-05-03T12:00:00Z"
        }
        """.trimIndent()

        val response = gson.fromJson(json, MatikaHealthResponse::class.java)

        assertEquals(MatikaHealthStatus.DEGRADED, response.status)
        assertEquals("down", response.checks.bedrock)
        assertNull(response.checks.bedrockInferenceRegion)
        assertEquals("AccessDenied", response.errors?.get("bedrock"))
    }
}
