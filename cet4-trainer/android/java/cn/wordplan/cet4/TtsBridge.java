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
    private volatile String pending;
    private volatile boolean pendingUk;
    private volatile float pendingRate = 1f;

    public TtsBridge(Context context) {
        try {
            tts = new TextToSpeech(context.getApplicationContext(), this);
        } catch (Throwable t) {
            tts = null;
        }
    }

    @Override
    public void onInit(int status) {
        if (status != TextToSpeech.SUCCESS) return;
        ready = true;
        String p = pending;
        if (p != null) {
            pending = null;
            speakNow(p, pendingUk, pendingRate);
        }
    }

    /** 桥在不在。网页靠这个判断该走哪条路。 */
    @JavascriptInterface
    public boolean available() {
        return true;
    }

    @JavascriptInterface
    public void speak(String text, String accent, float rate) {
        if (text == null) return;
        String s = text.trim();
        if (s.isEmpty()) return;
        boolean uk = accent != null && accent.toLowerCase(Locale.US).startsWith("uk");
        if (!ready) {
            pending = s;
            pendingUk = uk;
            pendingRate = rate;
            return;
        }
        speakNow(s, uk, rate);
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

    private void speakNow(String text, boolean uk, float rate) {
        try {
            if (tts == null) return;
            tts.setLanguage(uk ? Locale.UK : Locale.US);
            tts.setSpeechRate(rate <= 0f ? 1f : rate);
            if (Build.VERSION.SDK_INT >= 21) {
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "wordplan");
            } else {
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, null);
            }
        } catch (Throwable ignored) {
        }
    }
}
