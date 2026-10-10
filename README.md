# DYNAMO

Screenplay editor for videogames. Works with plain [Fountain](https://fountain.io) files (`.fountain`). Think of it as a lighter Final Draft.

One editor engine in `web/`, plus a thin native shell for each platform, the same way Discord ships.

```
web/                  shared engine (HTML/CSS/JS), the actual editor
  index.html          host page loaded by every shell
  bridge.js           routes the engine's file I/O to the native shell
  js/ css/            engine + fonts + spellcheck lexicon
apple/                macOS app (Swift, AppKit + WKWebView)
  Dynamo.xcodeproj    open in Xcode
  build.sh            build without Xcode (Command Line Tools only)
platforms/nextcloud/  original Nextcloud app (reference copy; live one stays in Nextcloud)
assets/               logo (svg + 1024 png)
examples/             sample .fountain
```

## Mac: build and run

**Without Xcode**, needs only `xcode-select --install`:

```sh
apple/build.sh --open
```

This builds `apple/build/Dynamo.app` and registers it as the handler for `.fountain` files. Drag the app into `/Applications` to keep it.

**With Xcode:** open `apple/Dynamo.xcodeproj` and press ⌘R.

## Windows: portable exe

```sh
windows/build.sh        # needs the .NET SDK; runs on macOS, Linux, or Windows
```

The output is `windows/build/Dynamo-windows.zip`. Unzip it anywhere and run `Dynamo.exe`. It needs no installer, no admin rights, and no .NET install. It uses the WebView2 runtime that ships with Windows 10 and 11.

- The menus stay inside the window. Shortcuts are Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Shift+S, and Ctrl+W.
- To open `.fountain` files by double-click, run `Associate .fountain files.cmd` once. It writes to the per-user registry (HKCU) and needs no admin rights. `Remove .fountain association.cmd` undoes it.
- A build made on a Mac has a generic exe icon, because Windows icon resources can only be embedded on Windows. The GitHub Actions `build` workflow builds on Windows and fixes this.

## Using it

- **Open:** double-click any `.fountain` file in Finder, drag it onto the Dynamo icon, or use File › Open… (⌘O). File › Open Recent lists your last files.
- **New:** File › New Screenplay (⌘N). The window starts as *Untitled*. The first ⌘S asks where to save it.
- **Save:** ⌘S. Dynamo also autosaves in place while you type, like Pages or TextEdit. File › Revert to Saved (and macOS version browsing) can roll back.
- **Save As…** (⇧⌘S) writes a copy under a new name.
- **Close:** ⌘W. If anything is unsaved, Dynamo asks before closing.
- **Format:** ⌘1–⌘8 set the element type (Scene Heading, Action, Character…).
- **View:** toggles the preview panel, spellcheck, element labels, and Dynamo tags.
- **Document Info…** (⌥⌘I) edits the Fountain title page (title, author, Dynamo mode on/off).

Files are plain UTF-8 Fountain text, so they also open in Highland, Slugline, and Fade In, or in any text editor.

## How the shell talks to the engine

The engine was written against Nextcloud WebDAV. On desktop, `bridge.js` intercepts those `fetch` calls:

| engine call | native side |
|---|---|
| `GET` (conflict check) | returns the document's current text |
| `PUT` (autosave) | updates the document, then autosaves to disk |
| `MKCOL` | no-op |

The shell drives the engine through `window.__dynamo`: `open(text, title)`, `flush()` (serialize before save or close), and `menu(title, label)`. The engine sends its File/Edit/Format/View model with `DynamoNative.cmd('menus')`, so the macOS menu bar always matches the in-page menus. Any future shell (Windows WebView2, Android WebView, iOS WKWebView) needs only the same message names: `ready`, `read`, `write`, `new`, `open`, `save`, `saveAs`, `close`, `menus`.

When you edit `web/`, check that it still runs inside Nextcloud: every native hook is gated on `window.DynamoNative`.
