// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LiveMark",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "LiveMark",
            path: "Sources/LiveMark",
            resources: [
                // .copy 保留文件名与层级: WKWebView loadFileURL 需要稳定的相对路径
                .copy("Resources/WebKernel")
            ],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("WebKit"),
            ]
        ),
    ]
)
