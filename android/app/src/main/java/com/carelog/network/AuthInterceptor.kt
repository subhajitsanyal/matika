package com.carelog.network

import android.util.Log
import com.carelog.auth.AuthRepository
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * OkHttp interceptor that adds the Cognito JWT token to cloud API requests.
 *
 * Retrieves the current ID token from Amplify's auth session and adds it
 * as a Bearer token in the Authorization header. Token refresh is handled
 * automatically by Amplify when the token is expired.
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val authRepository: AuthRepository
) : Interceptor {

    companion object {
        private const val TAG = "AuthInterceptor"
        private const val HEADER_AUTHORIZATION = "Authorization"
        private const val BEARER_PREFIX = "Bearer "
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        // Skip adding auth header if one is already present
        if (originalRequest.header(HEADER_AUTHORIZATION) != null) {
            return chain.proceed(originalRequest)
        }

        val token = try {
            // Use runBlocking because OkHttp interceptors are synchronous.
            // The Amplify token fetch is typically fast (cached) and handles
            // refresh automatically when the token is expired.
            runBlocking { authRepository.getIdToken() }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to retrieve auth token", e)
            null
        }

        if (token == null) {
            Log.w(TAG, "No auth token available, proceeding without authorization")
            return chain.proceed(originalRequest)
        }

        val authenticatedRequest = originalRequest.newBuilder()
            .header(HEADER_AUTHORIZATION, "$BEARER_PREFIX$token")
            .build()

        return chain.proceed(authenticatedRequest)
    }
}
