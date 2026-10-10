using System.Diagnostics;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Dynamo;

/// One window = one .fountain file. The web engine does the editing; this only
/// owns the file on disk, the dialogs, and the close prompt.
sealed class EditorForm : Form
{
    // web/ is embedded in the exe and served from this fake origin
    const string Origin = "https://dynamo.app/";
    const string Filter = "Fountain screenplay (*.fountain;*.spmd)|*.fountain;*.spmd|Text (*.txt)|*.txt|All files (*.*)|*.*";
    static readonly Assembly Asm = typeof(EditorForm).Assembly;
    static readonly Lazy<string> Lexicon = new(() =>
    {
        var words = Resource("js/lexicon-en-20k.txt")
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return "window._SP_LEXICON_EN = " + JsonSerializer.Serialize(words) + ";";
    });

    readonly WebView2 web = new() { Dock = DockStyle.Fill };
    string? path;
    string text = "";
    bool dirty, ready, closeConfirmed;

    string DocTitle => path != null ? Path.GetFileNameWithoutExtension(path) : "Untitled";

    public EditorForm(string? path)
    {
        if (path != null)
        {
            try { text = File.ReadAllText(path); this.path = path; }
            catch (Exception ex) { MessageBox.Show(ex.Message, "Dynamo — can't open file", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        }
        Icon = new Icon(Asm.GetManifestResourceStream("Dynamo.ico")!);
        Size = new Size(1280, 860);
        MinimumSize = new Size(820, 500);
        BackColor = Color.FromArgb(30, 30, 46);
        StartPosition = FormStartPosition.WindowsDefaultLocation;
        Controls.Add(web);
        UpdateTitle();
        Load += async (_, _) => await InitAsync();
    }

    async Task InitAsync()
    {
        var dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Dynamo", "WebView2");
        var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
        await web.EnsureCoreWebView2Async(env);
        var core = web.CoreWebView2;

        // F5/Ctrl+R/Ctrl+P etc. would reload or print the page; editing keys still work
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.IsStatusBarEnabled = false;

        core.AddWebResourceRequestedFilter(Origin + "*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += ServeAsset;
        await core.AddScriptToExecuteOnDocumentCreatedAsync(Lexicon.Value);
        await core.AddScriptToExecuteOnDocumentCreatedAsync(BridgeScript());
        core.WebMessageReceived += OnMessage;
        core.NewWindowRequested += (_, e) => { e.Handled = true; OpenOutside(e.Uri); };
        core.NavigationStarting += (_, e) =>
        {
            if (e.Uri.StartsWith(Origin)) return;
            e.Cancel = true;
            OpenOutside(e.Uri);
        };
        web.Source = new Uri(Origin + "index.html");
    }

    // dropped files arrive as file:// navigations; web links go to the browser
    static void OpenOutside(string uri)
    {
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var u)) return;
        if (u.IsFile && File.Exists(u.LocalPath)) Program.OpenWindow(u.LocalPath);
        else if (u.Scheme == Uri.UriSchemeHttps || u.Scheme == Uri.UriSchemeHttp)
            Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true });
    }

    // ── engine messages ──────────────────────────────────────────────

    async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        var msg = JsonNode.Parse(e.WebMessageAsJson)?.AsObject();
        if (msg == null) return;
        var id = msg["id"]?.GetValue<int>();
        object? result = null;
        switch ((string?)msg["cmd"])
        {
            case "ready": ready = true; await PushDocument(); break;
            case "read": result = text; break;
            case "write": EditorWrote((string?)msg["text"] ?? ""); break;
            case "new": Program.OpenWindow(null); break;
            case "open": ShowOpenDialog(); break;
            case "save": await SaveAsync(false); break;
            case "saveAs": await SaveAsync(true); break;
            case "close": Close(); break;
        }
        if (id != null && web.CoreWebView2 != null)
            web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { id, result }));
    }

    Task PushDocument() =>
        web.CoreWebView2.ExecuteScriptAsync($"__dynamo.open({JsonSerializer.Serialize(text)}, {JsonSerializer.Serialize(DocTitle)})");

    /// Engine autosave (debounced while typing). Named files save in place; untitled stay dirty.
    void EditorWrote(string s)
    {
        if (s == text) return;
        text = s;
        dirty = true;
        if (path != null) WriteDisk(quiet: true);
        UpdateTitle();
    }

    /// Pull the engine's current text (it may still be inside its autosave debounce).
    async Task Flush()
    {
        if (!ready) return;
        var json = await web.CoreWebView2.ExecuteScriptAsync("window.__dynamo ? __dynamo.flush() : null");
        var s = JsonSerializer.Deserialize<string?>(json);
        if (s != null && s != text) { text = s; dirty = true; }
    }

    async Task<bool> SaveAsync(bool asNew)
    {
        await Flush();
        if (asNew || path == null)
        {
            using var dlg = new SaveFileDialog
            {
                Filter = Filter,
                DefaultExt = "fountain",
                FileName = DocTitle + ".fountain",
            };
            if (dlg.ShowDialog(this) != DialogResult.OK) return false;
            path = dlg.FileName;
            await web.CoreWebView2.ExecuteScriptAsync(
                $"var t=document.querySelector('.sp-menubar .sp-title-input'); if (t) t.value = {JsonSerializer.Serialize(DocTitle)};");
        }
        var ok = WriteDisk(quiet: false);
        UpdateTitle();
        return ok;
    }

    bool WriteDisk(bool quiet)
    {
        try
        {
            File.WriteAllText(path!, text, new UTF8Encoding(false));
            dirty = false;
            return true;
        }
        catch (Exception ex)
        {
            if (!quiet) MessageBox.Show(this, ex.Message, "Dynamo — save failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return false;
        }
    }

    void ShowOpenDialog()
    {
        using var dlg = new OpenFileDialog { Filter = Filter, Multiselect = true };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        foreach (var f in dlg.FileNames) Program.OpenWindow(f);
    }

    void UpdateTitle() => Text = (dirty ? "• " : "") + DocTitle + " — Dynamo";

    // ── close: flush, autosave named files, ask about untitled/failed ──

    protected override async void OnFormClosing(FormClosingEventArgs e)
    {
        if (closeConfirmed || !ready) { base.OnFormClosing(e); return; }
        e.Cancel = true;

        await Flush();
        if (dirty && path != null) WriteDisk(quiet: true);
        if (dirty)
        {
            var answer = MessageBox.Show(this, $"Save changes to \"{DocTitle}\"?", "Dynamo",
                MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);
            if (answer == DialogResult.Cancel) return;
            if (answer == DialogResult.Yes && !await SaveAsync(false)) return;
        }
        closeConfirmed = true;
        BeginInvoke(Close);
    }

    // ── embedded web/ assets ─────────────────────────────────────────

    static Stream? OpenResource(string rel) =>
        Asm.GetManifestResourceStream("web/" + rel) ?? Asm.GetManifestResourceStream("web/" + rel.Replace('/', '\\'));

    static string Resource(string rel)
    {
        using var s = OpenResource(rel) ?? throw new FileNotFoundException(rel);
        using var r = new StreamReader(s);
        return r.ReadToEnd();
    }

    static string BridgeScript()
    {
        using var r = new StreamReader(Asm.GetManifestResourceStream("bridge-win.js")!);
        return r.ReadToEnd();
    }

    void ServeAsset(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var rel = Uri.UnescapeDataString(new Uri(e.Request.Uri).AbsolutePath.TrimStart('/'));
        var stream = OpenResource(rel);
        var envi = web.CoreWebView2.Environment;
        e.Response = stream == null
            ? envi.CreateWebResourceResponse(null, 404, "Not Found", "")
            : envi.CreateWebResourceResponse(stream, 200, "OK", "Content-Type: " + Mime(rel));
    }

    static string Mime(string rel) => Path.GetExtension(rel).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".js" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".txt" => "text/plain; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".woff2" => "font/woff2",
        _ => "application/octet-stream",
    };
}
