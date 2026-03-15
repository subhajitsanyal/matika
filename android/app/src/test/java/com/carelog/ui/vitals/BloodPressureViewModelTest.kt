package com.carelog.ui.vitals

import com.carelog.auth.AuthRepository
import com.carelog.fhir.repository.LocalFhirRepository
import com.carelog.voice.VoiceAcknowledgementPlayer
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for BloodPressureViewModel.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BloodPressureViewModelTest {

    private lateinit var viewModel: BloodPressureViewModel
    private lateinit var mockAuthRepository: AuthRepository
    private lateinit var mockLocalFhirRepository: LocalFhirRepository
    private lateinit var mockVoicePlayer: VoiceAcknowledgementPlayer

    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        mockAuthRepository = mockk(relaxed = true)
        mockLocalFhirRepository = mockk(relaxed = true)
        mockVoicePlayer = mockk(relaxed = true)
        viewModel = BloodPressureViewModel(mockAuthRepository, mockLocalFhirRepository, mockVoicePlayer)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // MARK: - Initial State Tests

    @Test
    fun `initial state has empty values`() {
        val state = viewModel.uiState.value
        assertEquals("", state.systolic)
        assertEquals("", state.diastolic)
        assertNull(state.systolicError)
        assertNull(state.diastolicError)
        assertFalse(state.canSave)
        assertFalse(state.isSaving)
        assertNull(state.saveError)
    }

    // MARK: - Systolic Validation Tests

    @Test
    fun `systolic valid value has no error`() {
        viewModel.updateSystolic("120")
        assertNull(viewModel.uiState.value.systolicError)
    }

    @Test
    fun `systolic too low shows error`() {
        viewModel.updateSystolic("59")
        assertEquals("Too low (min 60)", viewModel.uiState.value.systolicError)
    }

    @Test
    fun `systolic too high shows error`() {
        viewModel.updateSystolic("301")
        assertEquals("Too high (max 300)", viewModel.uiState.value.systolicError)
    }

    @Test
    fun `systolic boundary min 60 is valid`() {
        viewModel.updateSystolic("60")
        assertNull(viewModel.uiState.value.systolicError)
    }

    @Test
    fun `systolic boundary max 300 is valid`() {
        viewModel.updateSystolic("300")
        assertNull(viewModel.uiState.value.systolicError)
    }

    @Test
    fun `systolic empty value has no error`() {
        viewModel.updateSystolic("")
        assertNull(viewModel.uiState.value.systolicError)
    }

    @Test
    fun `systolic non-numeric value has no error but stores value`() {
        viewModel.updateSystolic("abc")
        assertNull(viewModel.uiState.value.systolicError)
        assertEquals("abc", viewModel.uiState.value.systolic)
    }

    // MARK: - Diastolic Validation Tests

    @Test
    fun `diastolic valid value has no error`() {
        viewModel.updateDiastolic("80")
        assertNull(viewModel.uiState.value.diastolicError)
    }

    @Test
    fun `diastolic too low shows error`() {
        viewModel.updateDiastolic("29")
        assertEquals("Too low (min 30)", viewModel.uiState.value.diastolicError)
    }

    @Test
    fun `diastolic too high shows error`() {
        viewModel.updateDiastolic("201")
        assertEquals("Too high (max 200)", viewModel.uiState.value.diastolicError)
    }

    @Test
    fun `diastolic boundary min 30 is valid`() {
        viewModel.updateDiastolic("30")
        assertNull(viewModel.uiState.value.diastolicError)
    }

    @Test
    fun `diastolic boundary max 200 is valid`() {
        viewModel.updateDiastolic("200")
        assertNull(viewModel.uiState.value.diastolicError)
    }

    @Test
    fun `diastolic empty value has no error`() {
        viewModel.updateDiastolic("")
        assertNull(viewModel.uiState.value.diastolicError)
    }

    // MARK: - canSave Tests

    @Test
    fun `canSave is false with empty values`() {
        assertFalse(viewModel.uiState.value.canSave)
    }

    @Test
    fun `canSave is false with only systolic`() {
        viewModel.updateSystolic("120")
        assertFalse(viewModel.uiState.value.canSave)
    }

    @Test
    fun `canSave is false with only diastolic`() {
        viewModel.updateDiastolic("80")
        assertFalse(viewModel.uiState.value.canSave)
    }

    @Test
    fun `canSave is true with valid systolic greater than diastolic`() {
        viewModel.updateSystolic("120")
        viewModel.updateDiastolic("80")
        assertTrue(viewModel.uiState.value.canSave)
    }

    @Test
    fun `canSave is false when systolic equals diastolic`() {
        viewModel.updateSystolic("100")
        viewModel.updateDiastolic("100")
        assertFalse(viewModel.uiState.value.canSave)
    }

    @Test
    fun `canSave is false when systolic less than diastolic`() {
        viewModel.updateSystolic("80")
        viewModel.updateDiastolic("120")
        assertFalse(viewModel.uiState.value.canSave)
    }

    @Test
    fun `canSave is false when systolic is invalid`() {
        viewModel.updateSystolic("50") // Too low
        viewModel.updateDiastolic("80")
        assertFalse(viewModel.uiState.value.canSave)
    }

    @Test
    fun `canSave is false when diastolic is invalid`() {
        viewModel.updateSystolic("120")
        viewModel.updateDiastolic("20") // Too low
        assertFalse(viewModel.uiState.value.canSave)
    }

    @Test
    fun `canSave is false with non-numeric systolic`() {
        viewModel.updateSystolic("abc")
        viewModel.updateDiastolic("80")
        assertFalse(viewModel.uiState.value.canSave)
    }

    @Test
    fun `canSave is false with non-numeric diastolic`() {
        viewModel.updateSystolic("120")
        viewModel.updateDiastolic("abc")
        assertFalse(viewModel.uiState.value.canSave)
    }

    @Test
    fun `canSave is false with decimal values`() {
        viewModel.updateSystolic("120.5")
        viewModel.updateDiastolic("80.5")
        // toIntOrNull returns null for decimal strings
        assertFalse(viewModel.uiState.value.canSave)
    }

    @Test
    fun `canSave is false with negative values`() {
        viewModel.updateSystolic("-120")
        viewModel.updateDiastolic("-80")
        // Negative values fail validation
        assertFalse(viewModel.uiState.value.canSave)
    }

    // MARK: - Boundary Tests

    @Test
    fun `canSave is true at minimum valid boundaries`() {
        viewModel.updateSystolic("61") // Must be > diastolic (30)
        viewModel.updateDiastolic("30")
        assertTrue(viewModel.uiState.value.canSave)
    }

    @Test
    fun `canSave is true at maximum valid boundaries`() {
        viewModel.updateSystolic("300")
        viewModel.updateDiastolic("200")
        assertTrue(viewModel.uiState.value.canSave)
    }

    // MARK: - State Update Tests

    @Test
    fun `updating systolic preserves diastolic value`() {
        viewModel.updateDiastolic("80")
        viewModel.updateSystolic("120")
        assertEquals("80", viewModel.uiState.value.diastolic)
    }

    @Test
    fun `updating diastolic preserves systolic value`() {
        viewModel.updateSystolic("120")
        viewModel.updateDiastolic("80")
        assertEquals("120", viewModel.uiState.value.systolic)
    }

    @Test
    fun `canSave updates when systolic changes`() {
        viewModel.updateSystolic("120")
        viewModel.updateDiastolic("80")
        assertTrue(viewModel.uiState.value.canSave)

        viewModel.updateSystolic("50") // Invalid
        assertFalse(viewModel.uiState.value.canSave)
    }

    @Test
    fun `canSave updates when diastolic changes`() {
        viewModel.updateSystolic("120")
        viewModel.updateDiastolic("80")
        assertTrue(viewModel.uiState.value.canSave)

        viewModel.updateDiastolic("20") // Invalid
        assertFalse(viewModel.uiState.value.canSave)
    }
}
