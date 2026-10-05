package cn.wordplan.cet4;

import android.app.Activity;
import android.content.res.Configuration;
import android.webkit.JavascriptInterface;

/**
 * 把「系统是不是深色模式」告诉网页。
 *
 * 为什么需要它：WebView 的 CSS {@code prefers-color-scheme} 跟的是 **Activity 的主题**，
 * 不是系统设置。本应用用的是 {@code Theme.Material.Light}，所以哪怕手机开了深色模式，
 * 网页里查到的也永远是 light。想知道真实情况，只能从 Java 这边读 Configuration 再递过去。
 */
public class SystemBridge {

    private final Activity activity;

    public SystemBridge(Activity activity) {
        this.activity = activity;
    }

    /** 系统当前是否为深色模式 */
    @JavascriptInterface
    public boolean isNightMode() {
        int mode = activity.getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    /** 顺便把状态栏高度报给网页（刘海屏 / 手势条下留白用得上） */
    @JavascriptInterface
    public int statusBarHeight() {
        int id = activity.getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? activity.getResources().getDimensionPixelSize(id) : 0;
    }
}
