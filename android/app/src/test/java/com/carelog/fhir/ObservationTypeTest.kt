package com.carelog.fhir

import com.carelog.fhir.client.ObservationType
import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for ObservationType enum.
 */
class ObservationTypeTest {

    @Test
    fun `all observation types have LOINC codes`() {
        ObservationType.entries.forEach { type ->
            assertNotNull("${type.name} should have LOINC code", type.loincCode)
            assertTrue("${type.name} LOINC code should not be empty", type.loincCode.isNotEmpty())
        }
    }

    @Test
    fun `all observation types have display names`() {
        ObservationType.entries.forEach { type ->
            assertNotNull("${type.name} should have display name", type.displayName)
            assertTrue("${type.name} display name should not be empty", type.displayName.isNotEmpty())
        }
    }

    @Test
    fun `all observation types have units`() {
        ObservationType.entries.forEach { type ->
            assertNotNull("${type.name} should have unit", type.unit)
            assertTrue("${type.name} unit should not be empty", type.unit.isNotEmpty())
        }
    }

    @Test
    fun `body weight has correct LOINC code`() {
        assertEquals("29463-7", ObservationType.BODY_WEIGHT.loincCode)
    }

    @Test
    fun `blood glucose has correct LOINC code`() {
        assertEquals("2339-0", ObservationType.BLOOD_GLUCOSE.loincCode)
    }

    @Test
    fun `body temperature has correct LOINC code`() {
        assertEquals("8310-5", ObservationType.BODY_TEMPERATURE.loincCode)
    }

    @Test
    fun `blood pressure has correct LOINC code`() {
        assertEquals("85354-9", ObservationType.BLOOD_PRESSURE.loincCode)
    }

    @Test
    fun `systolic BP has correct LOINC code`() {
        assertEquals("8480-6", ObservationType.SYSTOLIC_BP.loincCode)
    }

    @Test
    fun `diastolic BP has correct LOINC code`() {
        assertEquals("8462-4", ObservationType.DIASTOLIC_BP.loincCode)
    }

    @Test
    fun `heart rate has correct LOINC code`() {
        assertEquals("8867-4", ObservationType.HEART_RATE.loincCode)
    }

    @Test
    fun `oxygen saturation has correct LOINC code`() {
        assertEquals("2708-6", ObservationType.OXYGEN_SATURATION.loincCode)
    }

    @Test
    fun `body weight has correct unit`() {
        assertEquals("kg", ObservationType.BODY_WEIGHT.unit)
    }

    @Test
    fun `blood glucose has correct unit`() {
        assertEquals("mg/dL", ObservationType.BLOOD_GLUCOSE.unit)
    }

    @Test
    fun `heart rate has correct unit`() {
        assertEquals("/min", ObservationType.HEART_RATE.unit)
    }

    @Test
    fun `oxygen saturation has correct unit`() {
        assertEquals("%", ObservationType.OXYGEN_SATURATION.unit)
    }

    @Test
    fun `blood pressure components have mmHg unit`() {
        assertEquals("mmHg", ObservationType.BLOOD_PRESSURE.unit)
        assertEquals("mmHg", ObservationType.SYSTOLIC_BP.unit)
        assertEquals("mmHg", ObservationType.DIASTOLIC_BP.unit)
    }

    @Test
    fun `there are exactly 8 observation types`() {
        assertEquals(8, ObservationType.entries.size)
    }
}
