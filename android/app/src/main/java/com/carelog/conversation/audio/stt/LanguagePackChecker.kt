package com.carelog.conversation.audio.stt

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognizerIntent
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * Best-effort detection of which speech recognition languages the
 * device supports. Used by the onboarding flow to decide whether to
 * prompt the user to download an offline language pack.
 *
 * Caveat: pre-API 33 the platform conflates "online supported" with
 * "offline-installed pack" — the broadcast we use returns the union.
 * That means a language can show as supported here but still go online
 * at recognition time. Honest signal.
 *
 * Spec: docs/matika_spec_v2.md §3.1.
 */
@Singleton
class LanguagePackChecker @Inject constructor(
    @ApplicationContext private val appContext: Context,
) {
    /**
     * Returns the IETF tags the system reports as supported. Empty set
     * means the platform either has no recognition service or returned
     * nothing. Result is delivered via an ordered broadcast — the
     * speech service fills in extras synchronously when present.
     */
    suspend fun supportedLanguages(): Set<String> = withContext(Dispatchers.IO) {
        suspendCancellableCoroutine { cont ->
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context?, intent: Intent?) {
                    // getResultExtras(false) returns null when the speech
                    // service didn't fill any extras — treat that as "no
                    // languages reported" rather than throwing.
                    val results: Bundle? = getResultExtras(false)
                    val supported = results
                        ?.getStringArrayList(RecognizerIntent.EXTRA_SUPPORTED_LANGUAGES)
                        .orEmpty()
                        .toSet()
                    if (cont.isActive) cont.resume(supported)
                }
            }
            appContext.sendOrderedBroadcast(
                Intent(RecognizerIntent.ACTION_GET_LANGUAGE_DETAILS),
                /* receiverPermission = */ null,
                receiver,
                Handler(Looper.getMainLooper()),
                /* initialCode = */ 0,
                /* initialData = */ null,
                /* initialExtras = */ null,
            )
        }
    }

    /** True if [languageTag] (BCP-47) is in the platform's supported set. */
    suspend fun isSupported(languageTag: String): Boolean =
        supportedLanguages().any { it.equals(languageTag, ignoreCase = true) }
}
