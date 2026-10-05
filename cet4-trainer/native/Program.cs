/* 词计划 · Windows 桌面版
 *
 * 用 WebView2（系统里 Edge 自带的 Chromium）当渲染引擎，WinForms 当外壳。
 * 全部网页资源都以「嵌入资源」的形式编进这个 exe，第一次运行时解到
 *   %LOCALAPPDATA%\WordPlan\web
 * 然后用 SetVirtualHostNameToFolderMapping 把它映射成 https://wordplan.local，
 * 因此不需要起任何 HTTP 服务器，也不需要额外的文件。
 *
 * 编译：node tools/build_win.mjs
 *
 * 注意：这份代码必须能用 .NET Framework 自带的 csc.exe（C# 5）编译，
 * 所以不能用 $"字符串插值"、?.、nameof、表达式体成员。
 */
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace WordPlan
{
    internal static class Program
    {
        private static readonly object LogLock = new object();

        [STAThread]
        private static void Main(string[] args)
        {
            AppDomain.CurrentDomain.UnhandledException += delegate(object s, UnhandledExceptionEventArgs e)
            {
                Log("UNHANDLED: " + e.ExceptionObject);
            };
            Application.ThreadException += delegate(object s, System.Threading.ThreadExceptionEventArgs e)
            {
                Log("THREAD-EXCEPTION: " + e.Exception);
            };
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);

            Log("=== start, args=" + string.Join(" ", args));
            Log("LocalApplicationData=" + Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));

            // 必须在任何 WebView2 类型被加载之前挂好程序集解析
            EmbeddedBootstrap.Install();
            Log("bootstrap installed");

            string shot = null;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--shot" && i + 1 < args.Length)
                {
                    shot = args[i + 1];
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                Log("creating form");
                Application.Run(new MainForm(shot));
                Log("message loop ended");
            }
            catch (Exception ex)
            {
                Log("FATAL: " + ex);
                Fail(ex);
            }
        }

        /// <summary>排查启动问题用：依次尝试写到 exe 旁边、%TEMP%、%LOCALAPPDATA%\WordPlan。</summary>
        internal static void Log(string message)
        {
            string line = DateTime.Now.ToString("HH:mm:ss.fff") + "  " + message + "\r\n";
            string[] candidates;
            try
            {
                candidates = new string[]
                {
                    Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "startup.log"),
                    Path.Combine(Path.GetTempPath(), "wordplan-startup.log"),
                    Path.Combine(Payload.Root, "startup.log"),
                };
            }
            catch
            {
                return;
            }
            foreach (string file in candidates)
            {
                try
                {
                    string dir = Path.GetDirectoryName(file);
                    if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                    {
                        Directory.CreateDirectory(dir);
                    }
                    lock (LogLock)
                    {
                        File.AppendAllText(file, line);
                    }
                    return;
                }
                catch
                {
                }
            }
        }

        internal static void Fail(Exception ex)
        {
            string msg = "词计划启动失败：\r\n\r\n" + ex.Message;
            if (ex is WebView2RuntimeNotFoundException)
            {
                msg += "\r\n\r\n这台电脑上没找到 WebView2 运行时。\r\n"
                     + "装上微软官方的「Evergreen WebView2 Runtime」之后就能用了：\r\n"
                     + "https://developer.microsoft.com/microsoft-edge/webview2/";
            }
            try
            {
                MessageBox.Show(msg, "词计划", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            catch
            {
                Console.Error.WriteLine(msg);
            }
        }
    }

    /// <summary>把编译进来的两个 WebView2 托管 DLL 从内存里加载出来。</summary>
    internal static class EmbeddedBootstrap
    {
        private const string Prefix = "lib/";
        private static bool installed;

        public static void Install()
        {
            if (installed)
            {
                return;
            }
            installed = true;
            AppDomain.CurrentDomain.AssemblyResolve += Resolve;
        }

        private static Assembly Resolve(object sender, ResolveEventArgs args)
        {
            string simple = new AssemblyName(args.Name).Name;
            string resource = Prefix + simple + ".dll";
            Assembly self = Assembly.GetExecutingAssembly();
            using (Stream s = self.GetManifestResourceStream(resource))
            {
                if (s == null)
                {
                    return null;
                }
                byte[] bytes = new byte[s.Length];
                int read = 0;
                while (read < bytes.Length)
                {
                    int n = s.Read(bytes, read, bytes.Length - read);
                    if (n <= 0)
                    {
                        break;
                    }
                    read += n;
                }
                return Assembly.Load(bytes);
            }
        }
    }

    /// <summary>
    /// 目标机器上没装 WebView2 运行时怎么办：用内嵌的微软官方 bootstrapper 静默装一个。
    /// exe 里带着这 1.8 MB 的小程序，所以「下载下来双击就能用」这件事才成立。
    /// </summary>
    internal static class RuntimeInstaller
    {
        private const string Resource = "boot/WebView2Setup.exe";
        private const string DownloadPage = "https://developer.microsoft.com/microsoft-edge/webview2/";

        /// <summary>运行时在不在（顺便把 loader 目录设好）</summary>
        public static bool Ready()
        {
            try
            {
                CoreWebView2Environment.SetLoaderDllFolderPath(Payload.NativeDir);
                string version = CoreWebView2Environment.GetAvailableBrowserVersionString();
                return !string.IsNullOrEmpty(version);
            }
            catch (Exception ex)
            {
                Program.Log("runtime check failed: " + ex.Message);
                return false;
            }
        }

        /// <summary>问用户要不要自动装；装好了返回 true</summary>
        public static bool PromptAndInstall()
        {
            DialogResult answer = MessageBox.Show(
                "这台电脑上还没有 Microsoft Edge WebView2 运行时——「词计划」靠它来显示界面。\r\n\r\n"
                + "现在自动下载安装吗？大约 1 分钟，需要联网；只装给当前用户，不要管理员权限。\r\n\r\n"
                + "选「否」的话我会打开微软的下载页面，你手动装一次也一样。",
                "词计划 · 首次运行",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Information);
            if (answer != DialogResult.Yes)
            {
                OpenDownloadPage();
                return false;
            }
            if (!RunSetup() || !Ready())
            {
                MessageBox.Show(
                    "自动安装没能完成。\r\n\r\n"
                    + "多半是网络不通，或者被安全软件拦住了。\r\n"
                    + "点「确定」打开微软官方页面，手动装一次就行，装完再打开「词计划」。",
                    "词计划", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                OpenDownloadPage();
                return false;
            }
            return true;
        }

        private static bool RunSetup()
        {
            string exe = null;
            try
            {
                string dir = Path.Combine(Path.GetTempPath(), "WordPlanSetup");
                Directory.CreateDirectory(dir);
                exe = Path.Combine(dir, "MicrosoftEdgeWebview2Setup.exe");
                Assembly self = Assembly.GetExecutingAssembly();
                using (Stream src = self.GetManifestResourceStream(Resource))
                {
                    if (src == null)
                    {
                        Program.Log("bootstrapper resource missing");
                        return false;
                    }
                    using (FileStream dst = File.Create(exe))
                    {
                        src.CopyTo(dst);
                    }
                }
                Program.Log("bootstrapper -> " + exe);
                ProcessStartInfo psi = new ProcessStartInfo(exe, "/silent /install");
                psi.UseShellExecute = false;
                using (Process p = Process.Start(psi))
                {
                    if (p == null)
                    {
                        return false;
                    }
                    p.WaitForExit(10 * 60 * 1000);
                    Program.Log("bootstrapper exit=" + p.ExitCode);
                    return true;
                }
            }
            catch (Exception ex)
            {
                Program.Log("bootstrapper failed: " + ex.Message);
                return false;
            }
            finally
            {
                try
                {
                    if (exe != null && File.Exists(exe))
                    {
                        File.Delete(exe);
                    }
                }
                catch
                {
                }
            }
        }

        private static void OpenDownloadPage()
        {
            try
            {
                Process.Start(DownloadPage);
            }
            catch (Exception ex)
            {
                Program.Log("open download page failed: " + ex.Message);
            }
        }
    }

    /// <summary>把嵌入的网页资源与原生 loader 解出来，供 WebView2 读取。</summary>
    internal static class Payload
    {
        private const string WebPrefix = "web/";
        private const string NativePrefix = "native/";
        private static string cachedRoot;

        /// <summary>
        /// 数据目录：优先 %LOCALAPPDATA%\WordPlan；那里不可写（受限账户、被策略挡住、
        /// 或者 exe 放在只读位置）时退回 exe 旁边的 WordPlan-data，做成绿色便携版。
        /// </summary>
        public static string Root
        {
            get
            {
                if (cachedRoot != null)
                {
                    return cachedRoot;
                }
                string local = null;
                try
                {
                    string baseDir = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                    if (!string.IsNullOrEmpty(baseDir))
                    {
                        local = Path.Combine(baseDir, "WordPlan");
                    }
                }
                catch
                {
                }
                if (local != null && TryWritable(local))
                {
                    cachedRoot = local;
                    return cachedRoot;
                }
                string portable = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "WordPlan-data");
                TryWritable(portable);
                cachedRoot = portable;
                return cachedRoot;
            }
        }

        private static bool TryWritable(string dir)
        {
            try
            {
                Directory.CreateDirectory(dir);
                string probe = Path.Combine(dir, ".writetest");
                File.WriteAllText(probe, "ok");
                File.Delete(probe);
                return true;
            }
            catch
            {
                return false;
            }
        }

        public static string WebDir { get { return Path.Combine(Root, "web"); } }
        public static string NativeDir { get { return Path.Combine(Root, "native"); } }
        public static string UserDataDir { get { return Path.Combine(Root, "userdata"); } }

        public static void ExtractAll()
        {
            Assembly self = Assembly.GetExecutingAssembly();
            FileInfo info = new FileInfo(self.Location);
            string stamp = self.GetName().Version + "|" + info.Length;
            string stampFile = Path.Combine(Root, "payload.stamp");
            bool fresh = File.Exists(stampFile)
                         && File.ReadAllText(stampFile) == stamp
                         && File.Exists(Path.Combine(WebDir, "index.html"))
                         && File.Exists(Path.Combine(NativeDir, "WebView2Loader.dll"));
            if (fresh)
            {
                return;
            }

            Directory.CreateDirectory(Root);
            foreach (string name in self.GetManifestResourceNames())
            {
                string target;
                if (name.StartsWith(WebPrefix, StringComparison.Ordinal))
                {
                    target = Path.Combine(WebDir, name.Substring(WebPrefix.Length).Replace('/', Path.DirectorySeparatorChar));
                }
                else if (name.StartsWith(NativePrefix, StringComparison.Ordinal))
                {
                    target = Path.Combine(NativeDir, name.Substring(NativePrefix.Length).Replace('/', Path.DirectorySeparatorChar));
                }
                else
                {
                    continue;
                }

                string dir = Path.GetDirectoryName(target);
                if (!string.IsNullOrEmpty(dir))
                {
                    Directory.CreateDirectory(dir);
                }
                using (Stream src = self.GetManifestResourceStream(name))
                using (FileStream dst = new FileStream(target, FileMode.Create, FileAccess.Write))
                {
                    src.CopyTo(dst);
                }
            }
            File.WriteAllText(stampFile, stamp);
        }

        public static Icon LoadIcon()
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("icon/app.ico"))
            {
                return s == null ? null : new Icon(s);
            }
        }
    }

    public sealed class MainForm : Form
    {
        private readonly WebView2 web;
        private readonly string shotPath;
        private bool shotDone;

        public MainForm(string shot)
        {
            shotPath = shot;

            Text = "词计划 · 四级词汇周计划训练台";
            Width = 1340;
            Height = 920;
            MinimumSize = new Size(900, 640);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(244, 245, 250);
            try
            {
                Icon = Payload.LoadIcon();
            }
            catch
            {
            }

            web = new WebView2();
            web.Dock = DockStyle.Fill;
            Controls.Add(web);
            Load += OnLoad;
        }

        private async void OnLoad(object sender, EventArgs e)
        {
            try
            {
                Program.Log("form loaded, extracting payload");
                Payload.ExtractAll();
                Program.Log("payload extracted -> " + Payload.WebDir);

                // 原生 WebView2Loader.dll 就在我们自己解出来的目录里
                CoreWebView2Environment.SetLoaderDllFolderPath(Payload.NativeDir);
                Program.Log("loader path set");

                // 没装运行时的话，先用内嵌的官方 bootstrapper 装一个
                if (!RuntimeInstaller.Ready())
                {
                    Program.Log("runtime missing");
                    if (!RuntimeInstaller.PromptAndInstall())
                    {
                        Program.Log("runtime install declined/failed, giving up");
                        Close();
                        return;
                    }
                    Program.Log("runtime ready after install");
                }

                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, Payload.UserDataDir, null);
                Program.Log("environment created");
                await web.EnsureCoreWebView2Async(env);
                Program.Log("core webview ready");

                CoreWebView2Settings s = web.CoreWebView2.Settings;
                s.IsStatusBarEnabled = false;
                s.AreDevToolsEnabled = true;
                s.IsZoomControlEnabled = true;
                s.AreDefaultContextMenusEnabled = true;
                s.IsPasswordAutosaveEnabled = false;
                s.IsGeneralAutofillEnabled = false;

                web.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    "wordplan.local", Payload.WebDir, CoreWebView2HostResourceAccessKind.Allow);
                web.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
                Program.Log("navigating");
                web.CoreWebView2.Navigate("https://wordplan.local/index.html#practice");
            }
            catch (Exception ex)
            {
                Program.Log("INIT-FAILED: " + ex);
                Program.Fail(ex);
                Close();
            }
        }

        private async void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            Program.Log("navigation completed, success=" + e.IsSuccess + " status=" + e.WebErrorStatus);
            if (shotPath == null || shotDone)
            {
                return;
            }
            shotDone = true;
            try
            {
                await Task.Delay(3500);
                using (FileStream fs = new FileStream(shotPath, FileMode.Create, FileAccess.Write))
                {
                    await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, fs);
                }
                Program.Log("shot -> " + shotPath);
            }
            catch (Exception ex)
            {
                Program.Log("capture failed: " + ex);
            }
            Close();
        }
    }
}
