import Foundation

@main struct FileMonitorCheck {
    static func spin(_ seconds: TimeInterval) {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end { RunLoop.current.run(until: Date().addingTimeInterval(0.02)) }
    }
    static func wait(_ name: String, until condition: () -> Bool) {
        let end = Date().addingTimeInterval(4)
        while !condition() && Date() < end { spin(0.03) }
        precondition(condition(), "\(name): timed out")
        print("\(name): PASS")
    }
    static func main() throws {
        let folder = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appendingPathComponent("watched.md")
        let other = folder.appendingPathComponent("other.md")
        try "initial".write(to: file, atomically: true, encoding: .utf8)
        let monitor = FileChangeMonitor()
        var observed: [String] = []
        monitor.onChange = { if let text = try? String(contentsOf: file, encoding: .utf8) { observed.append(text) } }
        monitor.start(at: file)
        spin(0.3)
        try "in-place".write(to: file, atomically: false, encoding: .utf8)
        wait("in_place_write") { observed.last == "in-place" }
        try "atomic-first".write(to: file, atomically: true, encoding: .utf8)
        wait("atomic_replace") { observed.last == "atomic-first" }
        try "atomic-second".write(to: file, atomically: true, encoding: .utf8)
        wait("watch_rearmed_after_replace") { observed.last == "atomic-second" }
        let savedDate = try file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate!
        try "same-size-new".write(to: file, atomically: false, encoding: .utf8)
        try FileManager.default.setAttributes([.modificationDate: savedDate], ofItemAtPath: file.path)
        wait("same_size_and_timestamp_write") { observed.last == "same-size-new" }
        spin(0.3)
        let count = observed.count
        try "unrelated".write(to: other, atomically: true, encoding: .utf8)
        spin(1.3)
        precondition(observed.count == count, "Unrelated file triggered a reload")
        print("unrelated_write_and_idle: PASS")
        try FileManager.default.removeItem(at: file)
        spin(0.4)
        try "recreated".write(to: file, atomically: true, encoding: .utf8)
        wait("delete_and_recreate") { observed.last == "recreated" }
        monitor.stop()
        spin(0.3)
        let stoppedCount = observed.count
        try "after-stop".write(to: file, atomically: true, encoding: .utf8)
        spin(1.3)
        precondition(observed.count == stoppedCount, "Stopped monitor delivered events")
        print("stop_cancels_monitor: PASS")
        monitor.start(at: other)
        monitor.onChange = { if let text = try? String(contentsOf: other, encoding: .utf8) { observed.append(text) } }
        try "new-target".write(to: other, atomically: true, encoding: .utf8)
        wait("switch_watched_file") { observed.last == "new-target" }
        monitor.stop()
    }
}
