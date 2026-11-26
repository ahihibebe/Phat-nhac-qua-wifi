package com.musictoblutooth

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var multicastLock: WifiManager.MulticastLock? = null
    private var localWifiServer: LocalWifiServer? = null
    private var discoverySocket: DatagramSocket? = null
    @Volatile
    private var discoveredHostOrigin: String = ""
    @Volatile
    private var discoveryRunning = false

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val callback = filePathCallback ?: return@registerForActivityResult
        val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        callback.onReceiveValue(uris)
        filePathCallback = null
    }

    inner class AndroidBridge(
        private val lanOrigin: String,
        private val wsUrl: String,
        private val role: String
    ) {
        @JavascriptInterface
        fun getDiscoveredHost(): String = discoveredHostOrigin

        @JavascriptInterface
        fun getLanOrigin(): String = lanOrigin

        @JavascriptInterface
        fun getWsUrl(): String = wsUrl

        @JavascriptInterface
        fun getRole(): String = role
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        acquireWifiMulticastLock()

        var lanOrigin = ""
        var wsUrl = ""
        if (BuildConfig.APP_ROLE == "host") {
            val server = LocalWifiServer(applicationContext, 8765, 49153)
            server.start()
            localWifiServer = server
            val ip = server.getLocalIpv4Address() ?: "127.0.0.1"
            lanOrigin = "http://$ip:8765"
            wsUrl = "ws://127.0.0.1:8765/ws"
        } else {
            startUdpHostDiscovery()
        }

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/") { path ->
                val cleanPath = if (path.isEmpty() || path == "/") "index.html" else path.trimStart('/')
                try {
                    val stream = applicationContext.assets.open("www/$cleanPath")
                    val mime = when {
                        cleanPath.endsWith(".html") -> "text/html"
                        cleanPath.endsWith(".js") || cleanPath.endsWith(".mjs") -> "application/javascript"
                        cleanPath.endsWith(".css") -> "text/css"
                        cleanPath.endsWith(".jpg") || cleanPath.endsWith(".jpeg") -> "image/jpeg"
                        cleanPath.endsWith(".png") -> "image/png"
                        cleanPath.endsWith(".svg") -> "image/svg+xml"
                        cleanPath.endsWith(".json") -> "application/json"
                        else -> "application/octet-stream"
                    }
                    WebResourceResponse(mime, "UTF-8", stream)
                } catch (_: Exception) {
                    null
                }
            }
            .build()

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

            addJavascriptInterface(
                AndroidBridge(lanOrigin, wsUrl, BuildConfig.APP_ROLE),
                "__MTB_ANDROID__"
            )

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? {
                    return assetLoader.shouldInterceptRequest(request.url)
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {
                    this@MainActivity.filePathCallback?.onReceiveValue(null)
                    this@MainActivity.filePathCallback = filePathCallback

                    val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "audio/*"
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    }
                    return try {
                        fileChooserLauncher.launch(intent)
                        true
                    } catch (e: Exception) {
                        this@MainActivity.filePathCallback = null
                        false
                    }
                }
            }
        }

        setContentView(webView)

        val startUrl = if (BuildConfig.APP_ROLE == "receiver") {
            "https://appassets.androidplatform.net/index.html?role=receiver&room=MB48"
        } else {
            "https://appassets.androidplatform.net/index.html?room=MB48"
        }
        webView.loadUrl(startUrl)
    }

    private fun startUdpHostDiscovery() {
        discoveryRunning = true
        Thread {
            try {
                val sock = DatagramSocket(null).apply {
                    reuseAddress = true
                    bind(InetSocketAddress(49153))
                }
                discoverySocket = sock
                val buf = ByteArray(256)
                while (discoveryRunning) {
                    val packet = DatagramPacket(buf, buf.size)
                    sock.receive(packet)
                    val text = String(packet.data, 0, packet.length, Charsets.UTF_8)
                    val parts = text.split("|")
                    if (parts.size >= 3 && parts[0] == "MTB_HOST") {
                        val ip = parts[1].trim()
                        val port = parts[2].trim()
                        discoveredHostOrigin = "http://$ip:$port"
                    }
                }
            } catch (_: Exception) {
            }
        }.start()
    }

    private fun acquireWifiMulticastLock() {
        try {
            val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            multicastLock = wifiManager?.createMulticastLock("MusicToBlutoothLock")?.apply {
                setReferenceCounted(true)
                acquire()
            }
        } catch (_: Exception) {
        }
    }

    override fun onDestroy() {
        discoveryRunning = false
        try { discoverySocket?.close() } catch (_: Exception) {}
        localWifiServer?.stop()
        try {
            if (multicastLock?.isHeld == true) {
                multicastLock?.release()
            }
        } catch (_: Exception) {
        }
        webView.destroy()
        super.onDestroy()
    }
}
