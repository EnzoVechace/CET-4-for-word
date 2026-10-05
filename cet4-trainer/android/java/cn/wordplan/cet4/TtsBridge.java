package cn.wordplan.cet4;

import android.content.Context;
import android.os.Build;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;

import java.util.Locale;

/**
 * 发音桥：网页里的 speech.js 一发现 window.AndroidTTS 就直接走这里，
 * 不去指望 WebView 自带的 Web Speech（那个在 Android 上时灵时不灵）。
 * 换成系统的 TextToSpeech，音色由手机设置里的 TTS 引擎决定。
 */
public class TtsBridge implements TextToSpeech.OnInitListener {
    private TextToSpeech tts;
    private volatile boolean ready;
    /** 引擎起不来（没装 TTS、或初始化报错）。以前这里什么都没记，网页就永远以为有声。 */
    private volatile boolean failed;
    private volatile String pending;
    private volatile boolean pendingUk;
    private volatile boolean pendingZh;
    private volatile float pendingRate = 1f;

    public TtsBridge(Context context) {
        try {
            tts = new TextToSpeech(context.getApplicationContext(), this);
        } catch (Throwable t) {
            tts = null;
            failed = true;
        }
    }

    @Override
    public void onInit(int status) {
        if (status != TextToSpeech.SUCCESS) {
            // 这台机器没有可用的 TTS 引擎（模拟器、精简 ROM、用户禁用都会这样）
            failed = true;
            pending = null;
            return;
        }
        ready = true;
        String p = pending;
        if (p != null) {
            pending = null;
            speakNow(p, pendingUk, pendingZh, pendingRate);
        }
    }

    /**
     * 引擎是不是还能用。
     * 注意：**初始化期间返回 true**（表示「排队等着，有戏」），
     * 只有确定起不来（failed）才返回 false。网页不再靠它一票否决，
     * 真正的成败看 speak() 的返回值。
     */
    @JavascriptInterface
    public boolean available() {
        return !failed && tts != null;
    }

    /** 引擎是否已经初始化完成（诊断用） */
    @JavascriptInterface
    public boolean isReady() {
        return ready;
    }

    /**
     * 这台手机的 TTS 引擎支持哪些语言（诊断用）。
     * 只报英文和中文，免得把几十种语言全列出来；一个都没有就说明没装语音包。
     */
    @JavascriptInterface
    public String voices() {
        if (tts == null) return "(引擎没起来)";
        StringBuilder sb = new StringBuilder();
        int n = 0;
        try {
            // 常见的英文 / 中文变体
            String[] tags = {
                "en-US", "en-GB", "en-AU", "en-IN",
                "zh-CN", "zh-TW", "zh-HK",
            };
            for (String tag : tags) {
                Locale l = Locale.forLanguageTag(tag);
                int r = tts.isLanguageAvailable(l);
                if (r == TextToSpeech.LANG_AVAILABLE
                        || r == TextToSpeech.LANG_COUNTRY_AVAILABLE
                        || r == TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE) {
                    if (n > 0) sb.append(" | ");
                    sb.append(tag);
                    n++;
                }
            }
        } catch (Throwable t) {
            return "(查询出错：" + t.getClass().getSimpleName() + ")";
        }
        if (n == 0) {
            return "(没有可用的英文/中文语音包——去手机「设置 → 语言和输入法 → 文字转语音」里装一个)";
        }
        return "count=" + n + " | " + sb;
    }

    /**
     * 念一句。返回 false 表示**这次真的发不出声**（引擎没装/挂了），
     * 网页收到 false 就该退回 Web Speech 并提示用户，而不是干等着。
     */
    @JavascriptInterface
    public boolean speak(String text, String accent, float rate) {
        if (text == null) return false;
        String s = text.trim();
        if (s.isEmpty()) return false;
        if (failed || tts == null) return false;
        String a = accent == null ? "us" : accent.toLowerCase(Locale.US);
        boolean uk = a.startsWith("uk");
        boolean zh = a.startsWith("zh");
        if (!ready) {
            // 还在初始化：先记下来，onInit 成功后补念
            pending = s;
            pendingUk = uk;
            pendingZh = zh;
            pendingRate = rate;
            return true;
        }
        return speakNow(s, uk, zh, rate);
    }

    @JavascriptInterface
    public void stop() {
        pending = null;
        try {
            if (tts != null) tts.stop();
        } catch (Throwable ignored) {
        }
    }

    public void shutdown() {
        pending = null;
        ready = false;
        try {
            if (tts != null) {
                tts.stop();
                tts.shutdown();
            }
        } catch (Throwable ignored) {
        }
        tts = null;
    }

    private boolean speakNow(String text, boolean uk, boolean zh, float rate) {
        try {
            if (tts == null) return false;
            // 以前不管念什么一律 Locale.US —— 中文释义也被丢给英文嗓子，
            // 结果要么读成乱码要么直接没声。现在按 accent 选语言。
            Locale want = zh ? Locale.SIMPLIFIED_CHINESE : (uk ? Locale.UK : Locale.US);
            int lang = tts.setLanguage(want);
            // 想要的变体没装（比如只有 en-GB 没有 en-US）就退一步试同语系的另一个
            if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                Locale alt = zh ? Locale.TRADITIONAL_CHINESE : (uk ? Locale.US : Locale.UK);
                lang = tts.setLanguage(alt);
            }
            if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                // 手机上没装这门语言的语音包。别假装念了，让网页去提示用户怎么装。
                return false;
            }
            tts.setSpeechRate(rate <= 0f ? 1f : rate);
            int r;
            if (Build.VERSION.SDK_INT >= 21) {
                r = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "wordplan");
            } else {
                r = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null);
            }
            return r == TextToSpeech.SUCCESS;
        } catch (Throwable ignored) {
            return false;
        }
    }
}
