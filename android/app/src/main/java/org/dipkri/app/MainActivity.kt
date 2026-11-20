package org.dipkri.app

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

/**
 * dipkri Android shell.
 *
 * Loads the same web app the desktop shell loads. Step 1 exposes the bridge the
 * web build already looks for (`window.dipkriDesktop`), so the UI behaves like
 * the desktop app; the local torrent service is plugged in behind
 * getSidecar() in the next step.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    private val bridge = Bridge()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            userAgentString = userAgentString
                .replace("; wv", "")
                .replace(Regex("Version/\\d+\\.\\d+ "), "")
        }

        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                installBridge(view)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                installBridge(view)
            }
        }

        webView.addJavascriptInterface(bridge, "dipkriAndroid")
        webView.loadUrl(APP_URL)
    }

    /** Mirrors the Electron preload: same object name, same promise shape. */
    private fun installBridge(view: WebView?) {
        val shim = """
            (function () {
              if (window.dipkriDesktop) return;
              window.dipkriDesktop = {
                isDesktop: true,
                getSidecar: function () {
                  try { return Promise.resolve(JSON.parse(window.dipkriAndroid.getSidecar())); }
                  catch (e) { return Promise.resolve({ url: "", token: "", ready: false }); }
                },
                onSidecarPort: function () { return function () {}; }
              };
            })();
        """.trimIndent()
        view?.evaluateJavascript(shim, null)
    }

    inner class Bridge {
        @JavascriptInterface
        fun getSidecar(): String = "{\"url\":\"\",\"token\":\"\",\"ready\":false}"
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    companion object {
        const val APP_URL = "https://dipkri.duckdns.org"
    }
}
