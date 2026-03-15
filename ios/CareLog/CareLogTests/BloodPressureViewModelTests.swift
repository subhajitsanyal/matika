//
//  BloodPressureViewModelTests.swift
//  CareLogTests
//
//  Unit tests for BloodPressureViewModel
//

import XCTest
import Combine
@testable import CareLog

@MainActor
final class BloodPressureViewModelTests: XCTestCase {
    var viewModel: BloodPressureViewModel!
    var cancellables: Set<AnyCancellable>!

    override func setUp() async throws {
        try await super.setUp()
        viewModel = BloodPressureViewModel()
        cancellables = Set<AnyCancellable>()
    }

    override func tearDown() async throws {
        viewModel = nil
        cancellables = nil
        try await super.tearDown()
    }

    // MARK: - canSave Tests

    func testCanSave_emptyValues_returnsFalse() {
        viewModel.systolic = ""
        viewModel.diastolic = ""
        XCTAssertFalse(viewModel.canSave)
    }

    func testCanSave_validValues_returnsTrue() {
        viewModel.systolic = "120"
        viewModel.diastolic = "80"
        XCTAssertTrue(viewModel.canSave)
    }

    func testCanSave_invalidSystolic_tooLow_returnsFalse() {
        viewModel.systolic = "50"  // Below minimum of 60
        viewModel.diastolic = "80"
        XCTAssertFalse(viewModel.canSave)
    }

    func testCanSave_invalidSystolic_tooHigh_returnsFalse() {
        viewModel.systolic = "350"  // Above maximum of 300
        viewModel.diastolic = "80"
        XCTAssertFalse(viewModel.canSave)
    }

    func testCanSave_invalidDiastolic_tooLow_returnsFalse() {
        viewModel.systolic = "120"
        viewModel.diastolic = "20"  // Below minimum of 30
        XCTAssertFalse(viewModel.canSave)
    }

    func testCanSave_invalidDiastolic_tooHigh_returnsFalse() {
        viewModel.systolic = "120"
        viewModel.diastolic = "220"  // Above maximum of 200
        XCTAssertFalse(viewModel.canSave)
    }

    func testCanSave_systolicLessThanDiastolic_returnsFalse() {
        viewModel.systolic = "70"
        viewModel.diastolic = "80"
        XCTAssertFalse(viewModel.canSave)
    }

    func testCanSave_systolicEqualToDiastolic_returnsFalse() {
        viewModel.systolic = "100"
        viewModel.diastolic = "100"
        XCTAssertFalse(viewModel.canSave)
    }

    func testCanSave_nonNumericSystolic_returnsFalse() {
        viewModel.systolic = "abc"
        viewModel.diastolic = "80"
        XCTAssertFalse(viewModel.canSave)
    }

    func testCanSave_nonNumericDiastolic_returnsFalse() {
        viewModel.systolic = "120"
        viewModel.diastolic = "abc"
        XCTAssertFalse(viewModel.canSave)
    }

    // MARK: - Systolic Validation Tests

    func testSystolicValidation_validValue_noError() async {
        let expectation = XCTestExpectation(description: "Systolic validation")

        viewModel.$systolicError
            .dropFirst()  // Skip initial nil
            .sink { error in
                XCTAssertNil(error)
                expectation.fulfill()
            }
            .store(in: &cancellables)

        viewModel.systolic = "120"

        await fulfillment(of: [expectation], timeout: 1.0)
    }

    func testSystolicValidation_tooLow_showsError() async {
        let expectation = XCTestExpectation(description: "Systolic too low validation")

        viewModel.$systolicError
            .dropFirst()
            .sink { error in
                XCTAssertNotNil(error)
                XCTAssertTrue(error?.contains("Too low") ?? false)
                expectation.fulfill()
            }
            .store(in: &cancellables)

        viewModel.systolic = "50"

        await fulfillment(of: [expectation], timeout: 1.0)
    }

    func testSystolicValidation_tooHigh_showsError() async {
        let expectation = XCTestExpectation(description: "Systolic too high validation")

        viewModel.$systolicError
            .dropFirst()
            .sink { error in
                XCTAssertNotNil(error)
                XCTAssertTrue(error?.contains("Too high") ?? false)
                expectation.fulfill()
            }
            .store(in: &cancellables)

        viewModel.systolic = "350"

        await fulfillment(of: [expectation], timeout: 1.0)
    }

    func testSystolicValidation_boundaryMin_noError() async {
        let expectation = XCTestExpectation(description: "Systolic boundary min validation")

        viewModel.$systolicError
            .dropFirst()
            .sink { error in
                XCTAssertNil(error)
                expectation.fulfill()
            }
            .store(in: &cancellables)

        viewModel.systolic = "60"  // Minimum valid value

        await fulfillment(of: [expectation], timeout: 1.0)
    }

    func testSystolicValidation_boundaryMax_noError() async {
        let expectation = XCTestExpectation(description: "Systolic boundary max validation")

        viewModel.$systolicError
            .dropFirst()
            .sink { error in
                XCTAssertNil(error)
                expectation.fulfill()
            }
            .store(in: &cancellables)

        viewModel.systolic = "300"  // Maximum valid value

        await fulfillment(of: [expectation], timeout: 1.0)
    }

    // MARK: - Diastolic Validation Tests

    func testDiastolicValidation_validValue_noError() async {
        let expectation = XCTestExpectation(description: "Diastolic validation")

        viewModel.$diastolicError
            .dropFirst()
            .sink { error in
                XCTAssertNil(error)
                expectation.fulfill()
            }
            .store(in: &cancellables)

        viewModel.diastolic = "80"

        await fulfillment(of: [expectation], timeout: 1.0)
    }

    func testDiastolicValidation_tooLow_showsError() async {
        let expectation = XCTestExpectation(description: "Diastolic too low validation")

        viewModel.$diastolicError
            .dropFirst()
            .sink { error in
                XCTAssertNotNil(error)
                XCTAssertTrue(error?.contains("Too low") ?? false)
                expectation.fulfill()
            }
            .store(in: &cancellables)

        viewModel.diastolic = "20"

        await fulfillment(of: [expectation], timeout: 1.0)
    }

    func testDiastolicValidation_tooHigh_showsError() async {
        let expectation = XCTestExpectation(description: "Diastolic too high validation")

        viewModel.$diastolicError
            .dropFirst()
            .sink { error in
                XCTAssertNotNil(error)
                XCTAssertTrue(error?.contains("Too high") ?? false)
                expectation.fulfill()
            }
            .store(in: &cancellables)

        viewModel.diastolic = "220"

        await fulfillment(of: [expectation], timeout: 1.0)
    }

    func testDiastolicValidation_boundaryMin_noError() async {
        let expectation = XCTestExpectation(description: "Diastolic boundary min validation")

        viewModel.$diastolicError
            .dropFirst()
            .sink { error in
                XCTAssertNil(error)
                expectation.fulfill()
            }
            .store(in: &cancellables)

        viewModel.diastolic = "30"  // Minimum valid value

        await fulfillment(of: [expectation], timeout: 1.0)
    }

    func testDiastolicValidation_boundaryMax_noError() async {
        let expectation = XCTestExpectation(description: "Diastolic boundary max validation")

        viewModel.$diastolicError
            .dropFirst()
            .sink { error in
                XCTAssertNil(error)
                expectation.fulfill()
            }
            .store(in: &cancellables)

        viewModel.diastolic = "200"  // Maximum valid value

        await fulfillment(of: [expectation], timeout: 1.0)
    }

    // MARK: - Initial State Tests

    func testInitialState() {
        XCTAssertEqual(viewModel.systolic, "")
        XCTAssertEqual(viewModel.diastolic, "")
        XCTAssertNil(viewModel.systolicError)
        XCTAssertNil(viewModel.diastolicError)
        XCTAssertFalse(viewModel.isSaving)
        XCTAssertNil(viewModel.saveError)
        XCTAssertFalse(viewModel.canSave)
    }

    // MARK: - Edge Cases

    func testCanSave_decimalValues_returnsFalse() {
        // ViewModel expects Int, so decimal strings should fail
        viewModel.systolic = "120.5"
        viewModel.diastolic = "80.5"
        XCTAssertFalse(viewModel.canSave)
    }

    func testCanSave_negativeValues_returnsFalse() {
        viewModel.systolic = "-120"
        viewModel.diastolic = "-80"
        XCTAssertFalse(viewModel.canSave)
    }

    func testCanSave_whitespace_returnsFalse() {
        viewModel.systolic = " 120 "
        viewModel.diastolic = " 80 "
        XCTAssertFalse(viewModel.canSave)  // Int() doesn't handle whitespace
    }
}
