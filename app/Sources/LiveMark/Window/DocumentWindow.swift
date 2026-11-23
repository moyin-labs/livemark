import AppKit

final class DocumentWindow: NSWindow {
    var onRenameDocument: (() -> Void)?

    var documentTitleRect: NSRect {
        let textWidth = (title as NSString).size(withAttributes: [
            .font: NSFont.systemFont(ofSize: NSFont.systemFontSize, weight: .semibold),
        ]).width
        let width = min(textWidth + 48, max(0, frame.width - 200))
        let top = contentLayoutRect.maxY
        let left = standardWindowButton(.documentIconButton).map {
            $0.convert($0.bounds, to: nil).minX - 8
        } ?? (frame.width - width) / 2
        return NSRect(x: left, y: top, width: width, height: frame.height - top)
    }

    override func sendEvent(_ event: NSEvent) {
        if (event.type == .leftMouseDown || event.type == .leftMouseUp), event.clickCount == 2,
           documentTitleRect.contains(event.locationInWindow),
           let onRenameDocument {
            if event.type == .leftMouseUp { onRenameDocument() }
            return
        }
        super.sendEvent(event)
    }
}

final class DocumentRenameViewController: NSViewController, NSTextFieldDelegate {
    private let nameField: RenameTextField
    private let errorLabel = NSTextField(wrappingLabelWithString: "")
    private let rename: (String) throws -> Void
    weak var popover: NSPopover?

    init(filename: String, rename: @escaping (String) throws -> Void) {
        nameField = RenameTextField(string: filename)
        self.rename = rename
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func loadView() {
        nameField.setAccessibilityLabel("新文件名")
        nameField.delegate = self
        nameField.bezelStyle = .roundedBezel
        nameField.setContentHuggingPriority(.defaultLow, for: .horizontal)
        nameField.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let nameLabel = NSTextField(labelWithString: "名称：")
        nameLabel.setContentCompressionResistancePriority(.required, for: .horizontal)
        let nameRow = NSStackView(views: [nameLabel, nameField])
        nameRow.spacing = 8
        nameRow.alignment = .firstBaseline
        errorLabel.textColor = .systemRed
        errorLabel.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
        errorLabel.isHidden = true

        let cancel = NSButton(title: "取消", target: self, action: #selector(cancelRename(_:)))
        cancel.keyEquivalent = "\u{1b}"
        let confirm = NSButton(title: "重命名", target: self, action: #selector(applyRename(_:)))
        confirm.keyEquivalent = "\r"
        let actions = NSStackView(views: [cancel, confirm])
        actions.spacing = 8
        actions.setHuggingPriority(.required, for: .horizontal)

        let stack = NSStackView(views: [nameRow, errorLabel, actions])
        stack.orientation = .vertical
        stack.alignment = .trailing
        stack.spacing = 14
        // 使用独立容器约束留白，避免NSStackView的fittingSize压缩边缘间距。
        let container = NSView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(stack)
        NSLayoutConstraint.activate([
            container.widthAnchor.constraint(equalToConstant: 480),
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: container.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -18),
            nameRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            errorLabel.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
        view = container
        view.frame = NSRect(origin: .zero, size: container.fittingSize)
        preferredContentSize = view.frame.size
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        view.window?.makeFirstResponder(nameField)
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
        if commandSelector == #selector(NSResponder.insertNewline(_:)) {
            applyRename(control)
            return true
        }
        if commandSelector == #selector(NSResponder.cancelOperation(_:)) {
            cancelRename(control)
            return true
        }
        return false
    }

    override func cancelOperation(_ sender: Any?) { cancelRename(sender) }

    @objc private func applyRename(_ sender: Any?) {
        do {
            try rename(nameField.stringValue)
            popover?.performClose(sender)
        } catch {
            errorLabel.stringValue = error.localizedDescription
            errorLabel.isHidden = false
            view.layoutSubtreeIfNeeded()
            preferredContentSize = view.fittingSize
            popover?.contentSize = view.fittingSize
            view.window?.makeFirstResponder(nameField)
        }
    }

    @objc private func cancelRename(_ sender: Any?) { popover?.performClose(sender) }
}
