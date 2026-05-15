// EDGE-V2-09 chaos invoker — wraps a real BedrockInvoker but substitutes
// hardcoded malformed responses for fault-injection tests.
//
// Activated by the `x-test-chaos` request header at the API GW proxy
// layer (see index.ts handleProxyInvocation). Production never sets
// this header, so the chaos code only runs in deliberate test runs.
//
// Why a wrapper rather than env-var: each test is fully isolated to a
// single request. No `aws lambda update-function-configuration` round
// trip + restore step. No risk of leaving the lambda in a chaos state
// if a test crashes mid-run.

import type {
  BedrockInvoker,
  InvokeInput,
  InvokeResult,
  StreamChunk,
} from './bedrock_client';

export type ChaosMode = 'malformed_json';

/**
 * Recognised values for the `x-test-chaos` header. Returns null if the
 * header is missing or the value isn't recognised — production paths
 * fall through to the real invoker either way.
 */
export function parseChaosMode(headerValue: string | undefined | null): ChaosMode | null {
  if (!headerValue) return null;
  if (headerValue.toLowerCase() === 'malformed_json') return 'malformed_json';
  return null;
}

/**
 * Wraps a real invoker. Both `invoke` and `invokeStream` short-circuit
 * to a hardcoded malformed-JSON response so the parser fails the same
 * way it would if Bedrock dropped the structured-output envelope.
 *
 * Returns the SAME malformed text on every call so the handler's
 * stricter-prompt retry path (handler.ts:985 invokeWithRetry) also
 * fails parsing on the second attempt, triggering the canonical
 * EDGE-V2-09 path: HandlerError(503) with code prefix
 * `parse_failed_after_retry_`.
 */
export class MalformedJsonBedrockInvoker implements BedrockInvoker {
  // Plain text with no <output></output> envelope — parser hits
  // `no_output_tags` (a RETRIABLE_PARSE_FAILURE per handler.ts:955),
  // triggers the stricter-prompt retry, fails again, throws 503.
  private static readonly MALFORMED_TEXT =
    'Sorry, I had trouble formatting that. Could you say it differently?';

  constructor(private inner: BedrockInvoker) {}

  async invoke(input: InvokeInput): Promise<InvokeResult> {
    return {
      responseText: MalformedJsonBedrockInvoker.MALFORMED_TEXT,
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 20,
      guardrailBlocked: false,
      inferenceRegion: input.configuredRegion,
      rawStopReason: 'end_turn',
    };
  }

  // Streaming variant: emit the same malformed text as a single chunk
  // followed by a synthetic message_stop. The streaming parser uses
  // the same parseStructuredOutputDetailed under the hood, so it'll
  // hit the same `no_output_tags` failure and trigger the retry path.
  invokeStream(input: InvokeInput): AsyncIterable<StreamChunk> {
    const text = MalformedJsonBedrockInvoker.MALFORMED_TEXT;
    return (async function* () {
      yield { type: 'text_delta', text } as StreamChunk;
      yield {
        type: 'message_stop',
        usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 20 },
        stopReason: 'end_turn',
      } as StreamChunk;
      // Reference `input` to avoid an unused-parameter lint without
      // changing the public method signature.
      void input;
    })();
  }
}
