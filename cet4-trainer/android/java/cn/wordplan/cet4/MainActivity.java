package cn.wordplan.cet4;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

/**
 * 词计划 · 四级词汇周计划训练台 —— Android 外壳。
 *
 * 整个前端就是一份静态站点，打进 assets/web 里，
 * 由 AssetServer 架在 127.0.0.1 的随机端口上供 WebView 加载。
 */
public class MainActivity extends Activity {
    private static final int BG = 0xFFF4F5FA;

    private WebView web;
    private TextView splash;
    private AssetServer server;
    private TtsBridge tts;
    private SystemBridge systemBridge;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);

        web = new WebView(this);
        web.setBackgroundColor(BG);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        splash = new TextView(this);
        splash.setText("词计划\n正在准备词库…");
        splash.setTextColor(0xFF4F46E5);
        splash.setTextSize(17f);
        splash.setGravity(Gravity.CENTER);
        splash.setBackgroundColor(BG);
        root.addView(splash, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= 21) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }
        // 关掉 WebView 的「算法自动深色」：系统开了深色模式时，Android 会擅自把浅色页面
        // 反相一遍。本应用自带一套完整的深浅色主题（设置页可切换），两套叠在一起就花了。
        if (Build.VERSION.SDK_INT >= 29) {
            s.setForceDark(WebSettings.FORCE_DARK_OFF);
        }

        tts = new TtsBridge(this);
        web.addJavascriptInterface(tts, "AndroidTTS");
        systemBridge = new SystemBridge(this);
        web.addJavascriptInterface(systemBridge, "AndroidSystem");
        // 进度的原生兜底存储：网页端两边都写，取新一点的那份（见 store.js）
        web.addJavascriptInterface(new StoreBridge(this), "AndroidStore");
        // 允许用 adb + chrome://inspect 连进来调试（本地应用，方便自己排错）
        WebView.setWebContentsDebuggingEnabled(true);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (splash != null) splash.setVisibility(View.GONE);
            }
        });

        try {
            server = new AssetServer(getAssets(), "web");
            server.start();
            web.loadUrl("http://127.0.0.1:" + server.port + "/index.html#practice");
        } catch (Throwable t) {
            splash.setText("启动失败\n" + t);
            splash.setTextColor(Color.RED);
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
        if (tts != null) tts.stop();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    public void onConfigurationChanged(Configuration cfg) {
        super.onConfigurationChanged(cfg);
        // 系统切深浅色时 Activity 不会重建（manifest 里声明了 uiMode），
        // 只能在这里主动捅一下网页，让它重新决定该用哪套主题
        if (web != null) {
            web.evaluateJavascript(
                    "window.__onSystemTheme && window.__onSystemTheme();", null);
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("AndroidTTS");
            web.removeJavascriptInterface("AndroidSystem");
            web.stopLoading();
            web.destroy();
            web = null;
        }
        if (tts != null) {
            tts.shutdown();
            tts = null;
        }
        if (server != null) {
            server.stop();
            server = null;
        }
        super.onDestroy();
    }
}
