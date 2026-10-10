import AppKit
import WebKit

enum WebAssets {
    static let dir = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)

    static let bridge = (try? String(contentsOf: dir.appendingPathComponent("bridge.js"), encoding: .utf8)) ?? ""

    // Nextcloud embeds the spellcheck lexicon server-side; do the same here.
    static let lexicon: String = {
        let raw = (try? String(contentsOf: dir.appendingPathComponent("js/lexicon-en-20k.txt"), encoding: .utf8)) ?? ""
        let words = raw.split(whereSeparator: \.isNewline).map(String.init)
        let json = (try? JSONSerialization.data(withJSONObject: words)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        return "window._SP_LEXICON_EN = \(json);"
    }()
}

/// Breaks the WKUserContentController -> handler retain cycle.
private final class WeakHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var target: WKScriptMessageHandlerWithReply?
    init(_ target: WKScriptMessageHandlerWithReply) { self.target = target }

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let target else { replyHandler(nil, "gone"); return }
        target.userContentController(ucc, didReceive: message, replyHandler: replyHandler)
    }
}

final class EditorWindowController: NSWindowController, WKScriptMessageHandlerWithReply,
                                    WKUIDelegate, WKNavigationDelegate, NSWindowDelegate,
                                    NSMenuItemValidation {
    private var web: WKWebView!
    private var ready = false
    private var doc: Document? { document as? Document }
    private var menuModel: [[String: Any]] = []
    private static let engineTag = 7

    convenience init(document: Document) {
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
                           styleMask: [.titled, .closable, .miniaturizable, .resizable],
                           backing: .buffered, defer: false)
        win.minSize = NSSize(width: 820, height: 500)
        win.backgroundColor = NSColor(red: 0.118, green: 0.118, blue: 0.18, alpha: 1)
        win.tabbingMode = .preferred
        win.center()
        self.init(window: win)
        win.delegate = self
        shouldCascadeWindows = true

        let ucc = WKUserContentController()
        ucc.addScriptMessageHandler(WeakHandler(self), contentWorld: .page, name: "dynamo")
        ucc.addUserScript(WKUserScript(source: WebAssets.lexicon, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        ucc.addUserScript(WKUserScript(source: WebAssets.bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let cfg = WKWebViewConfiguration()
        cfg.userContentController = ucc

        web = WKWebView(frame: win.contentLayoutRect, configuration: cfg)
        web.uiDelegate = self
        web.navigationDelegate = self
        if #available(macOS 13.3, *) { web.isInspectable = true }
        win.contentView = web
        web.loadFileURL(WebAssets.dir.appendingPathComponent("index.html"), allowingReadAccessTo: WebAssets.dir)
    }

    // MARK: document <-> page

    func pushDocument() {
        guard ready, let doc else { return }
        let title = doc.fileURL?.deletingPathExtension().lastPathComponent ?? doc.displayName ?? "Untitled"
        web.callAsyncJavaScript("__dynamo.open(text, title)",
                                arguments: ["text": doc.text, "title": title],
                                in: nil, in: .page, completionHandler: nil)
    }

    func flush(_ done: @escaping (String?) -> Void) {
        guard ready else { done(nil); return }
        web.evaluateJavaScript("window.__dynamo ? __dynamo.flush() : null") { result, _ in
            done(result as? String)
        }
    }

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else {
            replyHandler(nil, "bad message"); return
        }
        switch cmd {
        case "ready":
            ready = true
            pushDocument()
        case "read":
            replyHandler(doc?.text ?? "", nil); return
        case "write":
            doc?.editorWrote(body["text"] as? String ?? "")
        case "new":
            NSDocumentController.shared.newDocument(nil)
        case "open":
            NSDocumentController.shared.openDocument(nil)
        case "save":
            doc?.save(nil)
        case "saveAs":
            doc?.saveAs(nil)
        case "close":
            window?.performClose(nil)
        case "menus":
            menuModel = body["menus"] as? [[String: Any]] ?? []
            if window?.isKeyWindow == true { applyMenus() }
        default:
            break
        }
        replyHandler(nil, nil)
    }

    // MARK: OS menu bar mirrors the editor's own menus

    func windowDidBecomeKey(_ notification: Notification) { applyMenus() }

    private func engineItems(_ title: String) -> [[String: Any]] {
        (menuModel.first { $0["title"] as? String == title }?["items"] as? [[String: Any]]) ?? []
    }

    private func applyMenus() {
        guard let main = NSApp.mainMenu else { return }
        for title in ["Format", "View"] {
            guard let sub = main.item(withTitle: title)?.submenu else { continue }
            sub.items.filter { $0.tag == Self.engineTag }.forEach(sub.removeItem)
            for (i, it) in engineItems(title).enumerated() {
                let mi: NSMenuItem
                if it["sep"] as? Bool == true {
                    mi = .separator()
                } else {
                    mi = NSMenuItem(title: it["label"] as? String ?? "", action: #selector(runEngineMenu(_:)), keyEquivalent: "")
                    mi.target = self
                    mi.representedObject = it
                    mi.state = it["checked"] as? Bool == true ? .on : .off
                    setAccel(it["accel"] as? String ?? "", on: mi)
                }
                mi.tag = Self.engineTag
                sub.insertItem(mi, at: i)
            }
        }
    }

    /// "⇧⌘S" style accel string from the engine -> key equivalent.
    private func setAccel(_ accel: String, on mi: NSMenuItem) {
        var mods: NSEvent.ModifierFlags = []
        var key = ""
        for ch in accel {
            switch ch {
            case "⌘": mods.insert(.command)
            case "⇧": mods.insert(.shift)
            case "⌥": mods.insert(.option)
            case "⌃": mods.insert(.control)
            default: key.append(ch)
            }
        }
        guard key.count == 1, !mods.isEmpty else { return }
        mi.keyEquivalent = key.lowercased()
        mi.keyEquivalentModifierMask = mods
    }

    private func runEngine(_ menu: String, _ label: String) {
        guard ready else { return }
        web.callAsyncJavaScript("__dynamo.menu(m, l)", arguments: ["m": menu, "l": label],
                                in: nil, in: .page, completionHandler: nil)
    }

    private func engineEnabled(_ menu: String, _ label: String) -> Bool {
        engineItems(menu).first { $0["label"] as? String == label }?["enabled"] as? Bool ?? false
    }

    @objc func runEngineMenu(_ sender: NSMenuItem) {
        guard let it = sender.representedObject as? [String: Any],
              let menu = it["menu"] as? String, let label = it["label"] as? String else { return }
        runEngine(menu, label)
    }

    @objc func showDocumentInfo(_ sender: Any?) { runEngine("File", "Document Info…") }
    @objc func engineUndo(_ sender: Any?) { runEngine("Edit", "Undo") }
    @objc func engineRedo(_ sender: Any?) { runEngine("Edit", "Redo") }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        case #selector(runEngineMenu(_:)):
            return (item.representedObject as? [String: Any])?["enabled"] as? Bool ?? true
        case #selector(engineUndo(_:)): return engineEnabled("Edit", "Undo")
        case #selector(engineRedo(_:)): return engineEnabled("Edit", "Redo")
        case #selector(showDocumentInfo(_:)): return ready
        default: return true
        }
    }

    // MARK: navigation — keep the page local, send web links to the browser

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.isFileURL || url.scheme == "about" { decisionHandler(.allow); return }
        if url.scheme == "https" || url.scheme == "http" { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }

    // MARK: alert / confirm / prompt as sheets

    private func present(_ alert: NSAlert, _ done: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window { alert.beginSheetModal(for: window, completionHandler: done) } else { done(alert.runModal()) }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "OK")
        present(a) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Cancel")
        present(a) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let a = NSAlert()
        a.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        field.stringValue = defaultText ?? ""
        a.accessoryView = field
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Cancel")
        a.window.initialFirstResponder = field
        present(a) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
    }
}
