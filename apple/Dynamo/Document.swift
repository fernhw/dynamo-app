import AppKit

/// One .fountain file. The web editor is the source of truth while open;
/// `text` is the last copy it handed us (on autosave or explicit sync).
@objc(Document)
final class Document: NSDocument {
    var text = ""
    weak var editor: EditorWindowController?

    override class var autosavesInPlace: Bool { true }

    override func makeWindowControllers() {
        let wc = EditorWindowController(document: self)
        editor = wc
        addWindowController(wc)
    }

    override func read(from data: Data, ofType typeName: String) throws {
        guard let s = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        text = s
        editor?.pushDocument() // revert / external reload
    }

    override func data(ofType typeName: String) throws -> Data {
        Data(text.utf8)
    }

    /// Called by the editor's own debounced autosave.
    func editorWrote(_ s: String) {
        guard s != text else { return }
        text = s
        updateChangeCount(.changeDone)
        autosave(withImplicitCancellability: false) { _ in }
    }

    /// Pull the editor's current text before any user-visible save/close.
    private func syncFromEditor(_ done: @escaping () -> Void) {
        guard let editor else { done(); return }
        editor.flush { [weak self] s in
            if let self, let s, s != self.text {
                self.text = s
                self.updateChangeCount(.changeDone)
            }
            done()
        }
    }

    override func save(_ sender: Any?) {
        syncFromEditor { super.save(sender) }
    }

    override func saveAs(_ sender: Any?) {
        syncFromEditor { super.saveAs(sender) }
    }

    override func canClose(withDelegate delegate: Any, shouldClose shouldCloseSelector: Selector?,
                           contextInfo: UnsafeMutableRawPointer?) {
        syncFromEditor {
            super.canClose(withDelegate: delegate, shouldClose: shouldCloseSelector, contextInfo: contextInfo)
        }
    }
}
