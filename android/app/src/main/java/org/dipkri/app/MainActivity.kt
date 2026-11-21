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

    // The OAuth popup, so the back button can close it instead of navigating
    // the room behind it.
    private var authDialog: Dialog? = null

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

                // A close row, otherwise a stuck OAuth flow traps the user.
                val root = android.widget.LinearLayout(this@MainActivity).apply {
                    orientation = android.widget.LinearLayout.VERTICAL
                    setBackgroundColor(0xFF0B0B12.toInt())
                }
                val bar = android.widget.LinearLayout(this@MainActivity).apply {
                    orientation = android.widget.LinearLayout.HORIZONTAL
                    setPadding(16, 12, 16, 12)
                }
                val title = android.widget.TextView(this@MainActivity).apply {
                    text = "Sign in"
                    setTextColor(0xFFE5E7EB.toInt())
                    textSize = 15f
                }
                val close = android.widget.TextView(this@MainActivity).apply {
                    text = "Close"
                    setTextColor(0xFFF87171.toInt())
                    textSize = 15f
                    setPadding(24, 0, 0, 0)
                }
                bar.addView(title, android.widget.LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                bar.addView(close, android.widget.LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
                root.addView(bar)
                root.addView(popup, android.widget.LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

                val dialog = Dialog(this@MainActivity).apply {
                    setContentView(root)
                    setOnDismissListener {
                        popup.destroy()
                        authDialog = null
                    }
                }
                close.setOnClickListener { dialog.dismiss() }

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

                authDialog = dialog
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

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val dialog = authDialog
        if (dialog != null && dialog.isShowing) {
            dialog.dismiss()
            return
        }
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    companion object {
        const val APP_URL = "https://dipkri.duckdns.org"
        const val APP_ORIGIN = "https://dipkri.duckdns.org"
    }
}
