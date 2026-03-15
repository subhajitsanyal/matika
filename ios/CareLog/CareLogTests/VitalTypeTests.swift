//
//  VitalTypeTests.swift
//  CareLogTests
//
//  Unit tests for VitalType enum
//

import XCTest
@testable import CareLog

final class VitalTypeTests: XCTestCase {

    // MARK: - LOINC Code Tests

    func testLoincCodes() {
        XCTAssertEqual(VitalType.bloodPressureSystolic.loincCode, "8480-6")
        XCTAssertEqual(VitalType.bloodPressureDiastolic.loincCode, "8462-4")
        XCTAssertEqual(VitalType.glucose.loincCode, "2339-0")
        XCTAssertEqual(VitalType.temperature.loincCode, "8310-5")
        XCTAssertEqual(VitalType.weight.loincCode, "29463-7")
        XCTAssertEqual(VitalType.pulse.loincCode, "8867-4")
        XCTAssertEqual(VitalType.spo2.loincCode, "2708-6")
    }

    // MARK: - Valid Range Tests

    func testValidRanges() {
        // Systolic BP: 60-250
        XCTAssertEqual(VitalType.bloodPressureSystolic.validRange, 60...250)
        XCTAssertTrue(VitalType.bloodPressureSystolic.validRange.contains(120))
        XCTAssertFalse(VitalType.bloodPressureSystolic.validRange.contains(59))
        XCTAssertFalse(VitalType.bloodPressureSystolic.validRange.contains(251))

        // Diastolic BP: 40-150
        XCTAssertEqual(VitalType.bloodPressureDiastolic.validRange, 40...150)
        XCTAssertTrue(VitalType.bloodPressureDiastolic.validRange.contains(80))
        XCTAssertFalse(VitalType.bloodPressureDiastolic.validRange.contains(39))
        XCTAssertFalse(VitalType.bloodPressureDiastolic.validRange.contains(151))

        // Glucose: 20-600
        XCTAssertEqual(VitalType.glucose.validRange, 20...600)
        XCTAssertTrue(VitalType.glucose.validRange.contains(100))
        XCTAssertFalse(VitalType.glucose.validRange.contains(19))
        XCTAssertFalse(VitalType.glucose.validRange.contains(601))

        // Temperature: 35-42
        XCTAssertEqual(VitalType.temperature.validRange, 35...42)
        XCTAssertTrue(VitalType.temperature.validRange.contains(37))
        XCTAssertFalse(VitalType.temperature.validRange.contains(34))
        XCTAssertFalse(VitalType.temperature.validRange.contains(43))

        // Weight: 1-300
        XCTAssertEqual(VitalType.weight.validRange, 1...300)
        XCTAssertTrue(VitalType.weight.validRange.contains(70))
        XCTAssertFalse(VitalType.weight.validRange.contains(0))
        XCTAssertFalse(VitalType.weight.validRange.contains(301))

        // Pulse: 30-220
        XCTAssertEqual(VitalType.pulse.validRange, 30...220)
        XCTAssertTrue(VitalType.pulse.validRange.contains(72))
        XCTAssertFalse(VitalType.pulse.validRange.contains(29))
        XCTAssertFalse(VitalType.pulse.validRange.contains(221))

        // SpO2: 50-100
        XCTAssertEqual(VitalType.spo2.validRange, 50...100)
        XCTAssertTrue(VitalType.spo2.validRange.contains(98))
        XCTAssertFalse(VitalType.spo2.validRange.contains(49))
        XCTAssertFalse(VitalType.spo2.validRange.contains(101))
    }

    // MARK: - Display Name Tests

    func testDisplayNames() {
        XCTAssertEqual(VitalType.bloodPressureSystolic.displayName, "Blood Pressure (Systolic)")
        XCTAssertEqual(VitalType.bloodPressureDiastolic.displayName, "Blood Pressure (Diastolic)")
        XCTAssertEqual(VitalType.glucose.displayName, "Glucose")
        XCTAssertEqual(VitalType.temperature.displayName, "Temperature")
        XCTAssertEqual(VitalType.weight.displayName, "Weight")
        XCTAssertEqual(VitalType.pulse.displayName, "Pulse")
        XCTAssertEqual(VitalType.spo2.displayName, "SpO2")
    }

    // MARK: - Default Unit Tests

    func testDefaultUnits() {
        XCTAssertEqual(VitalType.bloodPressureSystolic.defaultUnit, "mmHg")
        XCTAssertEqual(VitalType.bloodPressureDiastolic.defaultUnit, "mmHg")
        XCTAssertEqual(VitalType.glucose.defaultUnit, "mg/dL")
        XCTAssertEqual(VitalType.temperature.defaultUnit, "°C")
        XCTAssertEqual(VitalType.weight.defaultUnit, "kg")
        XCTAssertEqual(VitalType.pulse.defaultUnit, "bpm")
        XCTAssertEqual(VitalType.spo2.defaultUnit, "%")
    }

    // MARK: - Short Name Tests

    func testShortNames() {
        XCTAssertEqual(VitalType.bloodPressureSystolic.shortName, "BP")
        XCTAssertEqual(VitalType.bloodPressureDiastolic.shortName, "BP")
        XCTAssertEqual(VitalType.glucose.shortName, "Glucose")
        XCTAssertEqual(VitalType.temperature.shortName, "Temp")
        XCTAssertEqual(VitalType.weight.shortName, "Weight")
        XCTAssertEqual(VitalType.pulse.shortName, "Pulse")
        XCTAssertEqual(VitalType.spo2.shortName, "SpO2")
    }

    // MARK: - CaseIterable Tests

    func testAllCases() {
        XCTAssertEqual(VitalType.allCases.count, 7)
        XCTAssertTrue(VitalType.allCases.contains(.bloodPressureSystolic))
        XCTAssertTrue(VitalType.allCases.contains(.bloodPressureDiastolic))
        XCTAssertTrue(VitalType.allCases.contains(.glucose))
        XCTAssertTrue(VitalType.allCases.contains(.temperature))
        XCTAssertTrue(VitalType.allCases.contains(.weight))
        XCTAssertTrue(VitalType.allCases.contains(.pulse))
        XCTAssertTrue(VitalType.allCases.contains(.spo2))
    }

    // MARK: - Identifiable Tests

    func testIdentifiable() {
        XCTAssertEqual(VitalType.bloodPressureSystolic.id, "bloodPressureSystolic")
        XCTAssertEqual(VitalType.glucose.id, "glucose")
    }
}
