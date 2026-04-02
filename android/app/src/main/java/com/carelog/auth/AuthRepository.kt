package com.carelog.auth

import android.content.Context
import android.util.Log
import com.amplifyframework.auth.AuthSession
import com.amplifyframework.auth.AuthUserAttribute
import com.amplifyframework.auth.AuthUserAttributeKey
import com.amplifyframework.auth.cognito.AWSCognitoAuthPlugin
import com.amplifyframework.auth.cognito.AWSCognitoAuthSession
import com.amplifyframework.auth.cognito.result.AWSCognitoAuthSignOutResult
import com.amplifyframework.auth.options.AuthSignUpOptions
import com.amplifyframework.auth.result.AuthSignInResult
import com.amplifyframework.auth.result.AuthSignUpResult
import com.amplifyframework.core.Amplify
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Authentication state for the CareLog app.
 */
sealed class AuthState {
    object Loading : AuthState()
    object NotAuthenticated : AuthState()
    data class Authenticated(val user: CareLogUser) : AuthState()
    data class Error(val message: String) : AuthState()
}

/**
 * Represents a CareLog user with their persona type.
 */
data class CareLogUser(
    val userId: String,
    val email: String,
    val name: String,
    val personaType: PersonaType,
    val linkedPatientId: String? = null
)

/**
 * User persona types as defined in the PRD.
 */
enum class PersonaType {
    PATIENT,
    ATTENDANT,
    RELATIVE,
    DOCTOR;

    companion object {
        fun fromString(value: String?): PersonaType {
            return when (value?.lowercase()) {
                "patient" -> PATIENT
                "attendant" -> ATTENDANT
                "relative" -> RELATIVE
                "doctor" -> DOCTOR
                else -> {
                    if (value != null) {
                        android.util.Log.w("PersonaType", "Unknown persona type: $value, defaulting to PATIENT")
                    } else {
                        android.util.Log.w("PersonaType", "Persona type is null, defaulting to PATIENT")
                    }
                    PATIENT
                }
            }
        }
    }
}

/**
 * Repository for authentication operations using AWS Cognito via Amplify.
 *
 * Handles:
 * - User sign in/sign out
 * - User registration
 * - Token management (automatic refresh handled by Amplify)
 * - User attribute management
 */
@Singleton
class AuthRepository @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val _authState = MutableStateFlow<AuthState>(AuthState.Loading)
    val authState: StateFlow<AuthState> = _authState.asStateFlow()

    private val _currentUser = MutableStateFlow<CareLogUser?>(null)
    val currentUser: StateFlow<CareLogUser?> = _currentUser.asStateFlow()

    companion object {
        private const val TAG = "AuthRepository"
    }

    /**
     * Initialize Amplify and check current auth session.
     * Should be called on app startup.
     */
    suspend fun initialize() {
        try {
            // Amplify configuration is handled in CareLogApplication
            checkAuthSession()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize auth", e)
            _authState.value = AuthState.NotAuthenticated
        }
    }

    /**
     * Check current authentication session.
     */
    suspend fun checkAuthSession() {
        // Only show loading if we're not already authenticated (avoids mid-session flicker)
        if (_authState.value !is AuthState.Authenticated) {
            _authState.value = AuthState.Loading
        }
        try {
            val session = fetchAuthSession()
            if (session.isSignedIn) {
                val user = fetchCurrentUser()
                _currentUser.value = user
                _authState.value = AuthState.Authenticated(user)
            } else {
                _authState.value = AuthState.NotAuthenticated
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to check auth session", e)
            _authState.value = AuthState.NotAuthenticated
        }
    }

    /**
     * Sign in with email and password.
     */
    suspend fun signIn(email: String, password: String): Result<CareLogUser> {
        return try {
            _authState.value = AuthState.Loading
            val result = signInWithCognito(email, password)

            if (result.isSignedIn) {
                // If there's a pending persona from registration, write it now
                flushPendingPersona()
                val user = fetchCurrentUser()
                _currentUser.value = user
                _authState.value = AuthState.Authenticated(user)
                Result.success(user)
            } else {
                _authState.value = AuthState.NotAuthenticated
                Result.failure(Exception("Sign in incomplete: ${result.nextStep}"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Sign in failed", e)
            _authState.value = AuthState.Error(e.message ?: "Sign in failed")
            Result.failure(e)
        }
    }

    /**
     * Sign up a new user (relative flow).
     */
    suspend fun signUp(
        email: String,
        password: String,
        name: String,
        personaType: PersonaType
    ): Result<AuthSignUpResult> {
        return try {
            // Only send standard attributes during signup.
            // custom:persona_type is set after first sign-in via flushPendingPersona()
            // because Amplify's SignUp may reject custom attributes depending on pool config.
            val attributes = listOf(
                AuthUserAttribute(AuthUserAttributeKey.email(), email),
                AuthUserAttribute(AuthUserAttributeKey.name(), name)
            )

            val options = AuthSignUpOptions.builder()
                .userAttributes(attributes)
                .build()

            val result = signUpWithCognito(email, password, options)
            // Store persona locally so we can set it after first sign-in
            _pendingPersona = personaType
            Result.success(result)
        } catch (e: Exception) {
            Log.e(TAG, "Sign up failed", e)
            Result.failure(e)
        }
    }

    /** Persona selected during registration, persisted to SharedPreferences
     *  so it survives process death between registration and first sign-in. */
    private val prefs = context.getSharedPreferences("carelog_auth", Context.MODE_PRIVATE)

    private var _pendingPersona: PersonaType?
        get() = prefs.getString("pending_persona", null)?.let { PersonaType.fromString(it) }
        set(value) {
            if (value != null) {
                prefs.edit().putString("pending_persona", value.name.lowercase()).apply()
            } else {
                prefs.edit().remove("pending_persona").apply()
            }
        }

    /**
     * Write the pending persona type to Cognito user attributes.
     * Called after first sign-in following registration.
     */
    suspend fun flushPendingPersona() {
        val persona = _pendingPersona ?: return
        try {
            updateUserAttribute(
                AuthUserAttribute(
                    AuthUserAttributeKey.custom("persona_type"),
                    persona.name.lowercase()
                )
            )
            _pendingPersona = null
            // Refresh user so persona is reflected immediately
            val user = fetchCurrentUser()
            _currentUser.value = user
            _authState.value = AuthState.Authenticated(user)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to set persona_type attribute (custom attribute may not exist in pool)", e)
            // Don't clear pending — retry on next sign-in
            Log.w(TAG, "Will retry setting persona_type on next sign-in")
        }
    }

    /**
     * Confirm sign up with verification code.
     */
    suspend fun confirmSignUp(email: String, code: String): Result<Unit> {
        return try {
            confirmSignUpWithCognito(email, code)
            Result.success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Confirm sign up failed", e)
            Result.failure(e)
        }
    }

    /**
     * Sign out the current user.
     */
    suspend fun signOut(): Result<Unit> {
        return try {
            signOutFromCognito()
            _currentUser.value = null
            _authState.value = AuthState.NotAuthenticated
            Result.success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Sign out failed", e)
            Result.failure(e)
        }
    }

    /**
     * Update the linked patient ID in Cognito user attributes.
     * Called after patient creation so vitals link to the real patient entity.
     */
    suspend fun updateLinkedPatientId(patientId: String): Result<Unit> {
        return try {
            updateUserAttribute(
                AuthUserAttribute(
                    AuthUserAttributeKey.custom("linked_patient_id"),
                    patientId
                )
            )
            // Refresh local user state
            val user = fetchCurrentUser()
            _currentUser.value = user
            _authState.value = AuthState.Authenticated(user)
            Result.success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update linked patient ID", e)
            Result.failure(e)
        }
    }

    /**
     * Get the currently authenticated user synchronously.
     */
    fun getCurrentUser(): CareLogUser? = _currentUser.value

    /**
     * Get the current token for API calls.
     *
     * Returns the ID token because the API Gateway uses a COGNITO_USER_POOLS
     * authorizer which validates ID tokens (not access tokens).
     */
    suspend fun getAccessToken(): String? {
        return try {
            val session = fetchAuthSession() as? AWSCognitoAuthSession
            session?.userPoolTokensResult?.value?.idToken
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get ID token", e)
            null
        }
    }

    /**
     * Get the current ID token for API calls.
     */
    suspend fun getIdToken(): String? {
        return try {
            val session = fetchAuthSession() as? AWSCognitoAuthSession
            session?.userPoolTokensResult?.value?.idToken
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get ID token", e)
            null
        }
    }

    // Private helper methods using coroutines

    private suspend fun fetchAuthSession(): AuthSession = suspendCancellableCoroutine { cont ->
        Amplify.Auth.fetchAuthSession(
            { cont.resume(it) },
            { cont.resumeWithException(it) }
        )
    }

    private suspend fun signInWithCognito(email: String, password: String): AuthSignInResult =
        suspendCancellableCoroutine { cont ->
            Amplify.Auth.signIn(
                email,
                password,
                { cont.resume(it) },
                { cont.resumeWithException(it) }
            )
        }

    private suspend fun signUpWithCognito(
        email: String,
        password: String,
        options: AuthSignUpOptions
    ): AuthSignUpResult = suspendCancellableCoroutine { cont ->
        Amplify.Auth.signUp(
            email,
            password,
            options,
            { cont.resume(it) },
            { cont.resumeWithException(it) }
        )
    }

    private suspend fun confirmSignUpWithCognito(email: String, code: String) =
        suspendCancellableCoroutine<Unit> { cont ->
            Amplify.Auth.confirmSignUp(
                email,
                code,
                { cont.resume(Unit) },
                { cont.resumeWithException(it) }
            )
        }

    private suspend fun signOutFromCognito() = suspendCancellableCoroutine<Unit> { cont ->
        Amplify.Auth.signOut { result ->
            when (result) {
                is AWSCognitoAuthSignOutResult.CompleteSignOut -> cont.resume(Unit)
                is AWSCognitoAuthSignOutResult.PartialSignOut -> cont.resume(Unit)
                is AWSCognitoAuthSignOutResult.FailedSignOut -> {
                    cont.resumeWithException(result.exception)
                }
            }
        }
    }

    private suspend fun updateUserAttribute(attribute: AuthUserAttribute) =
        suspendCancellableCoroutine<Unit> { cont ->
            Amplify.Auth.updateUserAttribute(
                attribute,
                { cont.resume(Unit) },
                { cont.resumeWithException(it) }
            )
        }

    private suspend fun fetchCurrentUser(): CareLogUser = suspendCancellableCoroutine { cont ->
        Amplify.Auth.fetchUserAttributes(
            { attributes ->
                val email = attributes.find {
                    it.key == AuthUserAttributeKey.email()
                }?.value ?: ""

                val name = attributes.find {
                    it.key == AuthUserAttributeKey.name()
                }?.value ?: ""

                val personaType = attributes.find {
                    it.key == AuthUserAttributeKey.custom("persona_type") ||
                    it.key.keyString == "custom:persona_type"
                }?.value

                val linkedPatientId = attributes.find {
                    it.key == AuthUserAttributeKey.custom("linked_patient_id") ||
                    it.key.keyString == "custom:linked_patient_id"
                }?.value

                Amplify.Auth.getCurrentUser(
                    { authUser ->
                        cont.resume(
                            CareLogUser(
                                userId = authUser.userId,
                                email = email,
                                name = name,
                                personaType = PersonaType.fromString(personaType),
                                linkedPatientId = linkedPatientId
                            )
                        )
                    },
                    { cont.resumeWithException(it) }
                )
            },
            { cont.resumeWithException(it) }
        )
    }
}
