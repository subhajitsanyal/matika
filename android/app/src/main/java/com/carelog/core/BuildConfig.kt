package com.carelog.core

/**
 * Build configuration constants.
 *
 * IMPORTANT: API_BASE_URL changes on every fresh `terraform apply`.
 * After redeploying infrastructure, run `./scripts/update-app-config.sh`
 * from the project root to update this value automatically.
 * Do NOT commit personal API Gateway IDs — use the placeholder below
 * and let the config script populate the real value.
 */
object BuildConfig {
    const val DEBUG = true
    const val APPLICATION_ID = "com.carelog"
    const val BUILD_TYPE = "debug"
    const val VERSION_CODE = 5
    const val VERSION_NAME = "1.3.1"
    // Updated by scripts/update-app-config.sh — do not hardcode personal API Gateway IDs
    const val API_BASE_URL = "https://rsf93ac8bd.execute-api.ap-south-1.amazonaws.com/dev"

    /**
     * Routes the conversation screen between the v2 Bedrock-backed flow
     * (MatikaConversationScreen / MatikaConversationViewModel) and the
     * legacy v1 Mac-Mini flow (ConversationScreen / ConversationViewModel).
     *
     * Default `true` — pilot testing runs against v2. Flip to `false`
     * for emergency rollback during pilot ramp without touching the
     * v1 code path. This entire flag dissolves in Phase E when the
     * Mac-Mini surface is deleted.
     */
    const val USE_V2_INFERENCE = true
}
