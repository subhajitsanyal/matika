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
 * Unit tests for GlucoseViewModel.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GlucoseViewModelTest {

    private lateinit var viewModel: GlucoseViewModel
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
        viewModel = GlucoseViewModel(mockAuthRepository, mockLocalFhirRepository, mockVoicePlayer)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // MARK: - Initial State Tests

    @Test
    fun `initial state has empty value and mg-dL unit`() {
        val state = viewModel.uiState.value
        assertEquals("", state.value)
        assertEquals("mg/dL", state.unit)
        assertNull(state.mealTiming)
        assertNull(state.valueError)
        assertFalse(state.canSave)
        assertFalse(state.isSaving)
        assertNull(state.saveError)
    }

    // MARK: - mg/dL Validation Tests

    @Test
    fun `valid mg-dL value has no error`() {
        viewModel.updateValue("100")
        assertNull(viewModel.uiState.value.valueError)
    }

    @Test
    fun `mg-dL value too low shows error`() {
        viewModel.updateValue("19")
        assertEquals("Too low (min 20)", viewModel.uiState.value.valueError)
    }

    @Test
    fun `mg-dL value too high shows error`() {
        viewModel.updateValue("601")
        assertEquals("Too high (max 600)", viewModel.uiState.value.valueError)
    }

    @Test
    fun `mg-dL boundary min 20 is valid`() {
        viewModel.updateValue("20")
        assertNull(viewModel.uiState.value.valueError)
    }

    @Test
    fun `mg-dL boundary max 600 is valid`() {
        viewModel.updateValue("600")
        assertNull(viewModel.uiState.value.valueError)
    }

    @Test
    fun `empty value has no error`() {
        viewModel.updateValue("")
        assertNull(viewModel.uiState.value.valueError)
    }

    @Test
    fun `non-numeric value has no error but stores value`() {
        viewModel.updateValue("abc")
        assertNull(viewModel.uiState.value.valueError)
        assertEquals("abc", viewModel.uiState.value.value)
    }

    // MARK: - mmol/L Validation Tests

    @Test
    fun `valid mmol-L value has no error`() {
        viewModel.updateUnit("mmol/L")
        viewModel.updateValue("5.5")
        assertNull(viewModel.uiState.value.valueError)
    }

    @Test
    fun `mmol-L value too low shows error`() {
        viewModel.updateUnit("mmol/L")
        viewModel.updateValue("1.0")
        assertEquals("Too low (min 1.1)", viewModel.uiState.value.valueError)
    }

    @Test
    fun `mmol-L value too high shows error`() {
        viewModel.updateUnit("mmol/L")
        viewModel.updateValue("33.4")
        assertEquals("Too high (max 33.3)", viewModel.uiState.value.valueError)
    }

    @Test
    fun `mmol-L boundary min 1-1 is valid`() {
        viewModel.updateUnit("mmol/L")
        viewModel.updateValue("1.1")
        assertNull(viewModel.uiState.value.valueError)
    }

    @Test
    fun `mmol-L boundary max 33-3 is valid`() {
        viewModel.updateUnit("mmol/L")
        viewModel.updateValue("33.3")
        assertNull(viewModel.uiState.value.valueError)
    }

    // MARK: - Unit Conversion Tests

    @Test
    fun `switching from mg-dL to mmol-L converts value`() {
        viewModel.updateValue("180") // 180 mg/dL
        viewModel.updateUnit("mmol/L")
        // 180 / 18 = 10.0
        assertEquals("10.0", viewModel.uiState.value.value)
    }

    @Test
    fun `switching from mmol-L to mg-dL converts value`() {
        viewModel.updateUnit("mmol/L")
        viewModel.updateValue("10.0") // 10.0 mmol/L
        viewModel.updateUnit("mg/dL")
        // 10.0 * 18 = 180
        assertEquals("180", viewModel.uiState.value.value)
    }

    @Test
    fun `switching units with empty value keeps empty`() {
        viewModel.updateValue("")
        viewModel.updateUnit("mmol/L")
        assertEquals("", viewModel.uiState.value.value)
    }

    @Test
    fun `switching units with invalid value clears value`() {
        viewModel.updateValue("abc")
        viewModel.updateUnit("mmol/L")
        assertEquals("", viewModel.uiState.value.value)
    }

    // MARK: - canSave Tests

    @Test
    fun `canSave is false with empty value`() {
        assertFalse(viewModel.uiState.value.canSave)
    }

    @Test
    fun `canSave is true with valid mg-dL value`() {
        viewModel.updateValue("100")
        assertTrue(viewModel.uiState.value.canSave)
    }

    @Test
    fun `canSave is true with valid mmol-L value`() {
        viewModel.updateUnit("mmol/L")
        viewModel.updateValue("5.5")
        assertTrue(viewModel.uiState.value.canSave)
    }

    @Test
    fun `canSave is false with invalid value`() {
        viewModel.updateValue("10") // Too low
        assertFalse(viewModel.uiState.value.canSave)
    }

    @Test
    fun `canSave is false with non-numeric value`() {
        viewModel.updateValue("abc")
        assertFalse(viewModel.uiState.value.canSave)
    }

    @Test
    fun `canSave is false with negative value`() {
        viewModel.updateValue("-100")
        assertFalse(viewModel.uiState.value.canSave)
    }

    @Test
    fun `canSave is false with zero value`() {
        viewModel.updateValue("0")
        assertFalse(viewModel.uiState.value.canSave)
    }

    // MARK: - Meal Timing Tests

    @Test
    fun `can update meal timing to fasting`() {
        viewModel.updateMealTiming(MealTiming.FASTING)
        assertEquals(MealTiming.FASTING, viewModel.uiState.value.mealTiming)
    }

    @Test
    fun `can update meal timing to before meal`() {
        viewModel.updateMealTiming(MealTiming.BEFORE_MEAL)
        assertEquals(MealTiming.BEFORE_MEAL, viewModel.uiState.value.mealTiming)
    }

    @Test
    fun `can update meal timing to after meal`() {
        viewModel.updateMealTiming(MealTiming.AFTER_MEAL)
        assertEquals(MealTiming.AFTER_MEAL, viewModel.uiState.value.mealTiming)
    }

    @Test
    fun `meal timing does not affect canSave`() {
        viewModel.updateValue("100")
        assertTrue(viewModel.uiState.value.canSave)

        viewModel.updateMealTiming(MealTiming.FASTING)
        assertTrue(viewModel.uiState.value.canSave)
    }

    // MARK: - Decimal Value Tests

    @Test
    fun `decimal values are accepted for mg-dL`() {
        viewModel.updateValue("100.5")
        assertNull(viewModel.uiState.value.valueError)
        assertTrue(viewModel.uiState.value.canSave)
    }

    @Test
    fun `decimal values are accepted for mmol-L`() {
        viewModel.updateUnit("mmol/L")
        viewModel.updateValue("5.55")
        assertNull(viewModel.uiState.value.valueError)
        assertTrue(viewModel.uiState.value.canSave)
    }

    // MARK: - State Preservation Tests

    @Test
    fun `updating value preserves unit`() {
        viewModel.updateUnit("mmol/L")
        viewModel.updateValue("5.5")
        assertEquals("mmol/L", viewModel.uiState.value.unit)
    }

    @Test
    fun `updating meal timing preserves value and unit`() {
        viewModel.updateValue("100")
        viewModel.updateMealTiming(MealTiming.FASTING)
        assertEquals("100", viewModel.uiState.value.value)
        assertEquals("mg/dL", viewModel.uiState.value.unit)
    }

    // MARK: - Whitespace Tests

    @Test
    fun `whitespace value has no error but cannot save`() {
        viewModel.updateValue("   ")
        assertNull(viewModel.uiState.value.valueError)
        assertFalse(viewModel.uiState.value.canSave)
    }
}
