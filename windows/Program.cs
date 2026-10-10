namespace Dynamo;

static class Program
{
    static int openWindows;

    [STAThread]
    static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var files = args.Where(File.Exists).ToList();
        if (files.Count == 0) OpenWindow(null);
        else files.ForEach(OpenWindow);
        Application.Run();
    }

    public static void OpenWindow(string? path)
    {
        var form = new EditorForm(path);
        openWindows++;
        form.FormClosed += (_, _) => { if (--openWindows == 0) Application.ExitThread(); };
        form.Show();
    }
}
