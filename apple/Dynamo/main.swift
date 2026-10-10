import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationWillFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = buildMainMenu()
    }

    func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool { true }
}

private func item(_ title: String, _ action: String?, _ key: String = "",
                  _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
    let i = NSMenuItem(title: title, action: action.map(NSSelectorFromString), keyEquivalent: key)
    i.keyEquivalentModifierMask = mods
    return i
}

private func menu(_ title: String, _ items: [NSMenuItem]) -> NSMenuItem {
    let top = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    let m = NSMenu(title: title)
    items.forEach(m.addItem)
    top.submenu = m
    return top
}

private func buildMainMenu() -> NSMenu {
    let main = NSMenu()

    main.addItem(menu("Dynamo", [
        item("About Dynamo", "orderFrontStandardAboutPanel:"),
        .separator(),
        item("Hide Dynamo", "hide:", "h"),
        item("Hide Others", "hideOtherApplications:", "h", [.command, .option]),
        item("Show All", "unhideAllApplications:"),
        .separator(),
        item("Quit Dynamo", "terminate:", "q"),
    ]))

    let recent = NSMenu(title: "Open Recent")
    recent.addItem(item("Clear Menu", "clearRecentDocuments:"))
    // lets NSDocumentController fill this menu with recent files
    recent.perform(NSSelectorFromString("_setMenuName:"), with: "NSRecentDocumentsMenu")
    let recentItem = NSMenuItem(title: "Open Recent", action: nil, keyEquivalent: "")
    recentItem.submenu = recent

    main.addItem(menu("File", [
        item("New Screenplay", "newDocument:", "n"),
        item("Open…", "openDocument:", "o"),
        recentItem,
        .separator(),
        item("Document Info…", "showDocumentInfo:", "i", [.command, .option]),
        .separator(),
        item("Close", "performClose:", "w"),
        item("Save", "saveDocument:", "s"),
        item("Save As…", "saveDocumentAs:", "s", [.command, .shift]),
        item("Revert to Saved", "revertDocumentToSaved:"),
    ]))

    // Undo/Redo go to the editor's block history; no key equivalents so ⌘Z isn't fired twice
    main.addItem(menu("Edit", [
        item("Undo", "engineUndo:"),
        item("Redo", "engineRedo:"),
        .separator(),
        item("Cut", "cut:", "x"),
        item("Copy", "copy:", "c"),
        item("Paste", "paste:", "v"),
        item("Select All", "selectAll:", "a"),
    ]))

    // Format + View items are filled from the editor (EditorWindowController.applyMenus)
    main.addItem(menu("Format", []))

    main.addItem(menu("View", [
        .separator(),
        item("Enter Full Screen", "toggleFullScreen:", "f", [.command, .control]),
    ]))

    let window = menu("Window", [
        item("Minimize", "performMiniaturize:", "m"),
        item("Zoom", "performZoom:"),
        .separator(),
        item("Bring All to Front", "arrangeInFront:"),
    ])
    main.addItem(window)
    NSApp.windowsMenu = window.submenu

    return main
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
