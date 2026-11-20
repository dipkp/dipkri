package org.dipkri.app

import android.annotation.SuppressLint
import android.app.Dialog
import android.graphics.Bitmap
import android.os.Bundle
import android.os.Message
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

/**
 * dipkri Android shell.
 *
 * Loads the same web app the desktop shell loads and exposes
 * window.dipkriDesktop through the native bridge.
 *
 * Google sign-in uses a popup, so the WebView has to support multiple windows
 * and third-party cookies; without both, Firebase resolves to a blank page.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val bridge = Bridge()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        CookieManager.getInstance().setAcceptCookie(true)

        webView = WebView(this)
        setContentView(webView)

        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = true
            userAgentString = userAgentString
                .replace("; wv", "")
                .replace(Regex("Version/\\d+\\.\\d+ "), "")
        }

        webView.webChromeClient = object : WebChromeClient() {
            // Firebase signInWithPopup asks for a new window; give it a real one
            // with the same cookies, or the flow ends on a blank page.
            override fun onCreateWindow(
                view: WebView?,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: Message?,
            ): Boolean {
                val popup = WebView(this@MainActivity)
                popup.settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    setSupportMultipleWindows(true)
                }
                CookieManager.getInstance().setAcceptThirdPartyCookies(popup, true)

                val dialog = Dialog(this@MainActivity).apply {
                    setContentView(
                        popup,
                        ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT,
                        ),
                    )
                    setOnDismissListener { popup.destroy() }
                }

                popup.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(
                        view: WebView?,
                        request: WebResourceRequest?,
                    ): Boolean = false

                    override fun onPageFinished(view: WebView?, url: String?) {
                        super.onPageFinished(view, url)
                        // The popup's job is done when it comes back to the app.
                        if (url != null && url.startsWith(APP_ORIGIN) && dialog.isShowing) {
                            view?.postDelayed({ dialog.dismiss() }, 600)
                        }
                    }
                }
                popup.webChromeClient = object : WebChromeClient() {
                    override fun onCloseWindow(window: WebView?) {
                        super.onCloseWindow(window)
                        if (dialog.isShowing) dialog.dismiss()
                    }
                }

                dialog.show()
                val transport = resultMsg?.obj as? WebView.WebViewTransport ?: return false
                transport.webView = popup
                resultMsg.sendToTarget()
                return true
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?,
            ): Boolean {
                val url = request?.url?.toString() ?: return false
                // Keep Google/Firebase inside; send everything else out.
                val internal = url.startsWith(APP_ORIGIN) ||
                    url.contains("accounts.google.com") ||
                    url.contains("firebaseapp.com") ||
                    url.contains("google.com")
                return !internal
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                installBridge(view)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                installBridge(view)
            }
        }

        webView.addJavascriptInterface(bridge, "dipkriAndroid")

        try {
            TorrentService.start(this)
        } catch (e: Throwable) {
            android.util.Log.w("dipkri", "service start failed: ${e.message}")
        }

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
        fun getSidecar(): String = TorrentService.sidecarJson()
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    companion object {
        const val APP_URL = "https://dipkri.duckdns.org"
        const val APP_ORIGIN = "https://dipkri.duckdns.org"
    }
}
