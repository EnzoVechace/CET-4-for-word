package cn.wordplan.cet4;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;

/**
 * 背词进度的原生兜底存储。
 *
 * <p>为什么不只用 WebView 的 localStorage：那是 Chromium 的 LevelDB，什么时候
 * 落盘由它自己决定。安卓在后台把进程收掉（清后台、内存吃紧）时不一定来得及
 * 刷盘，用户就会遇到「背了半天，再打开又回到第一个词」。SharedPreferences
 * 是系统级存储，{@code apply()} 之后由系统负责落盘，用它再存一份兜底。
 *
 * <p>网页端 {@code store.js} 两边都写、启动时取新一点的那份；所以这里存的
 * 东西永远是完整的整份状态 JSON，不做字段级合并。
 */
public class StoreBridge {

    private static final String PREF = "wordplan";
    private static final String KEY = "state";

    private final SharedPreferences prefs;

    public StoreBridge(Context ctx) {
        prefs = ctx.getApplicationContext().getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    /** 上次存下的整份状态；没有就返回空串 */
    @JavascriptInterface
    public String load() {
        try {
            String s = prefs.getString(KEY, "");
            return s == null ? "" : s;
        } catch (Throwable t) {
            return "";
        }
    }

    /** 落一份到原生存储 */
    @JavascriptInterface
    public void save(String json) {
        if (json == null || json.isEmpty()) return;
        try {
            prefs.edit().putString(KEY, json).apply();
        } catch (Throwable ignored) {
            // 存不下也不能让页面崩
        }
    }

    @JavascriptInterface
    public void clear() {
        try {
            prefs.edit().remove(KEY).apply();
        } catch (Throwable ignored) {
        }
    }
}
