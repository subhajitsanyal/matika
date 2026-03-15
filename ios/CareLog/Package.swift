// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "CareLog",
    platforms: [
        .iOS(.v17)
    ],
    products: [
        .library(
            name: "CareLog",
            targets: ["CareLog"]
        ),
    ],
    dependencies: [
        // Stanford Spezi Framework
        .package(url: "https://github.com/StanfordSpezi/Spezi.git", from: "1.2.0"),
        .package(url: "https://github.com/StanfordSpezi/SpeziAccount.git", from: "1.2.0"),
        .package(url: "https://github.com/StanfordSpezi/SpeziFHIR.git", from: "0.6.0"),
        .package(url: "https://github.com/StanfordSpezi/SpeziStorage.git", from: "1.0.0"),
        .package(url: "https://github.com/StanfordSpezi/SpeziScheduler.git", from: "0.8.0"),
        .package(url: "https://github.com/StanfordSpezi/SpeziOnboarding.git", from: "1.1.0"),

        // AWS Amplify for Cognito Authentication
        .package(url: "https://github.com/aws-amplify/amplify-swift.git", from: "2.25.0"),

        // FHIR Models (ModelsR4)
        .package(url: "https://github.com/apple/FHIRModels.git", from: "0.5.0"),
    ],
    targets: [
        .target(
            name: "CareLog",
            dependencies: [
                .product(name: "Spezi", package: "Spezi"),
                .product(name: "SpeziAccount", package: "SpeziAccount"),
                .product(name: "SpeziFHIR", package: "SpeziFHIR"),
                .product(name: "SpeziLocalStorage", package: "SpeziStorage"),
                .product(name: "SpeziScheduler", package: "SpeziScheduler"),
                .product(name: "SpeziOnboarding", package: "SpeziOnboarding"),
                .product(name: "Amplify", package: "amplify-swift"),
                .product(name: "AWSCognitoAuthPlugin", package: "amplify-swift"),
                .product(name: "AWSS3StoragePlugin", package: "amplify-swift"),
                .product(name: "ModelsR4", package: "FHIRModels"),
            ],
            path: "CareLog"
        ),
        .testTarget(
            name: "CareLogTests",
            dependencies: ["CareLog"],
            path: "CareLogTests"
        ),
    ]
)
