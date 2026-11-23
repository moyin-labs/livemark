import Foundation
import Darwin

/// 同时监听文件与父目录，原子替换后重新绑定文件描述符；定时核对补偿漏报。
final class FileChangeMonitor {
    private struct Signature: Equatable {
        let inode: UInt64
        let size: UInt64
        let modified: Date?
        let created: Date?
    }
    var onChange: (() -> Void)?
    private var url: URL?
    private var signature: Signature?
    private var fileSource: DispatchSourceFileSystemObject?
    private var directorySource: DispatchSourceFileSystemObject?
    private var timer: DispatchSourceTimer?
    private var pending: DispatchWorkItem?
    private var forcePending = false
    private var generation = 0

    func start(at url: URL?) {
        stop()
        guard let url else { return }
        self.url = url
        let expectedGeneration = generation
        signature = Self.signature(at: url)
        bindFile()
        directorySource = observe(url.deletingLastPathComponent()) { [weak self] in self?.schedule(force: false) }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 1, repeating: 1, leeway: .milliseconds(150))
        timer.setEventHandler { [weak self] in
            guard let self, self.generation == expectedGeneration else { return }
            self.check(force: false)
        }
        self.timer = timer
        timer.resume()
    }

    func stop() {
        generation += 1
        forcePending = false
        pending?.cancel(); pending = nil
        fileSource?.cancel(); fileSource = nil
        directorySource?.cancel(); directorySource = nil
        timer?.cancel(); timer = nil
        url = nil
        signature = nil
    }

    private func bindFile() {
        fileSource?.cancel()
        fileSource = nil
        guard let url else { return }
        fileSource = observe(url) { [weak self] in self?.schedule(force: true) }
    }

    private func observe(_ url: URL, changed: @escaping () -> Void) -> DispatchSourceFileSystemObject? {
        let descriptor = open(url.path, O_EVTONLY)
        guard descriptor >= 0 else { return nil }
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: descriptor,
            eventMask: [.write, .extend, .attrib, .rename, .delete, .revoke],
            queue: .main
        )
        let expectedGeneration = generation
        source.setEventHandler { [weak self] in
            guard self?.generation == expectedGeneration else { return }
            changed()
        }
        source.setCancelHandler { close(descriptor) }
        source.resume()
        return source
    }

    private func schedule(force: Bool) {
        pending?.cancel()
        forcePending = forcePending || force
        let expectedGeneration = generation
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.generation == expectedGeneration else { return }
            let forced = self.forcePending
            self.forcePending = false
            self.check(force: forced)
        }
        pending = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: work)
    }

    private func check(force: Bool) {
        guard let url else { return }
        let latest = Self.signature(at: url)
        let changed = latest != signature
        if changed || fileSource == nil { bindFile() }
        signature = latest
        if changed || force { onChange?() }
    }

    private static func signature(at url: URL) -> Signature? {
        guard let values = try? FileManager.default.attributesOfItem(atPath: url.path) else { return nil }
        return Signature(
            inode: (values[.systemFileNumber] as? NSNumber)?.uint64Value ?? 0,
            size: (values[.size] as? NSNumber)?.uint64Value ?? 0,
            modified: values[.modificationDate] as? Date,
            created: values[.creationDate] as? Date
        )
    }

    deinit { stop() }
}
