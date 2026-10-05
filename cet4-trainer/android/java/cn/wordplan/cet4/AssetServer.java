package cn.wordplan.cet4;

import android.content.res.AssetManager;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;

/**
 * 一个只伺候 127.0.0.1 的极简静态文件服务器，内容来自 APK 的 assets。
 *
 * 为什么要多此一举开服务器？因为 file:// 页面在 Android WebView 里
 * localStorage 的归属很不可靠，而 127.0.0.1 是一个正经的 http 源
 * （而且是安全上下文，Service Worker 也能用），跟电脑上跑 server.mjs 完全一致。
 */
public class AssetServer {
    private final AssetManager assets;
    private final String root;
    private ServerSocket socket;
    private Thread thread;
    public volatile int port;

    public AssetServer(AssetManager assets, String root) {
        this.assets = assets;
        this.root = root;
    }

    /** 首选端口。**必须固定**：localStorage 是按「协议+主机+端口」分家的，
     *  端口一变就是一个全新的源，用户的背词进度每次启动都会丢。 */
    private static final int PREFERRED_PORT = 17653;

    public void start() throws IOException {
        InetAddress loop = InetAddress.getByName("127.0.0.1");
        ServerSocket bound = null;
        for (int p = PREFERRED_PORT; p < PREFERRED_PORT + 24 && bound == null; p++) {
            try {
                bound = new ServerSocket(p, 16, loop);
            } catch (IOException busy) {
                // 端口被占用就试下一个；实在都不行才退回随机端口
            }
        }
        if (bound == null) {
            bound = new ServerSocket(0, 16, loop);
        }
        socket = bound;
        port = socket.getLocalPort();
        thread = new Thread(new Runnable() {
            @Override
            public void run() {
                loop();
            }
        });
        thread.setDaemon(true);
        thread.setName("wordplan-assets");
        thread.start();
    }

    public void stop() {
        ServerSocket s = socket;
        socket = null;
        try {
            if (s != null) s.close();
        } catch (IOException ignored) {
        }
        Thread t = thread;
        thread = null;
        if (t != null) t.interrupt();
    }

    private void loop() {
        while (socket != null) {
            Socket c = null;
            try {
                c = socket.accept();
                serve(c);
            } catch (IOException e) {
                // socket 被 close 就会走到这里，属正常退出
            } catch (Throwable t) {
                // 单个请求出错不该拖垮整个服务
            } finally {
                if (c != null) {
                    try {
                        c.close();
                    } catch (IOException ignored) {
                    }
                }
            }
        }
    }

    private void serve(Socket c) throws IOException {
        c.setSoTimeout(10000);

        String head = readHead(c.getInputStream());
        if (head == null) return;

        String requestLine = head;
        int nl = head.indexOf('\r');
        if (nl >= 0) requestLine = head.substring(0, nl);
        String[] parts = requestLine.split(" ");
        if (parts.length < 2) return;

        String method = parts[0];
        String target = parts[1];

        int q = target.indexOf('?');
        if (q >= 0) target = target.substring(0, q);
        int h = target.indexOf('#');
        if (h >= 0) target = target.substring(0, h);
        if (target.isEmpty() || target.equals("/")) target = "/index.html";
        if (target.startsWith("/")) target = target.substring(1);

        if (target.contains("..")) {
            send(c, 403, "text/plain; charset=utf-8", "forbidden".getBytes("UTF-8"));
            return;
        }
        if (!"GET".equals(method) && !"HEAD".equals(method)) {
            send(c, 405, "text/plain; charset=utf-8", "method not allowed".getBytes("UTF-8"));
            return;
        }

        byte[] body;
        try {
            body = readAsset(root + "/" + target);
        } catch (IOException e) {
            send(c, 404, "text/plain; charset=utf-8", ("not found: " + target).getBytes("UTF-8"));
            return;
        }
        send(c, 200, mimeOf(target), "HEAD".equals(method) ? new byte[0] : body);
    }

    private static String readHead(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream(1024);
        int state = 0;
        int b;
        while ((b = in.read()) != -1) {
            buf.write(b);
            if (b == '\r' && (state == 0 || state == 2)) state++;
            else if (b == '\n' && (state == 1 || state == 3)) state++;
            else state = 0;
            if (state == 4) break;
            if (buf.size() > 16384) break;
        }
        if (buf.size() == 0) return null;
        return new String(buf.toByteArray(), "UTF-8");
    }

    private byte[] readAsset(String path) throws IOException {
        InputStream is = assets.open(path);
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream(65536);
            byte[] chunk = new byte[65536];
            int n;
            while ((n = is.read(chunk)) > 0) out.write(chunk, 0, n);
            return out.toByteArray();
        } finally {
            try {
                is.close();
            } catch (IOException ignored) {
            }
        }
    }

    private static void send(Socket c, int code, String type, byte[] body) throws IOException {
        OutputStream os = c.getOutputStream();
        String reason = code == 200 ? "OK" : code == 403 ? "Forbidden" : code == 404 ? "Not Found" : "Error";
        StringBuilder sb = new StringBuilder();
        sb.append("HTTP/1.1 ").append(code).append(' ').append(reason).append("\r\n");
        sb.append("Content-Type: ").append(type).append("\r\n");
        sb.append("Content-Length: ").append(body.length).append("\r\n");
        sb.append("Cache-Control: no-cache\r\n");
        sb.append("Connection: close\r\n");
        sb.append("\r\n");
        os.write(sb.toString().getBytes("UTF-8"));
        os.write(body);
        os.flush();
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html; charset=utf-8";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".json")) return "application/json; charset=utf-8";
        if (p.endsWith(".webmanifest")) return "application/manifest+json; charset=utf-8";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".txt")) return "text/plain; charset=utf-8";
        if (p.endsWith(".woff2")) return "font/woff2";
        // 单词发音（tools/fetch_audio.mjs 抓的 Ogg Opus / MP3）
        if (p.endsWith(".ogg") || p.endsWith(".opus")) return "audio/ogg";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".m4a")) return "audio/mp4";
        if (p.endsWith(".wav")) return "audio/wav";
        return "application/octet-stream";
    }
}
