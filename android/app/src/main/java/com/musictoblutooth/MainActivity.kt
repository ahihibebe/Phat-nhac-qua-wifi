package com.musictoblutooth

import android.Manifest
import android.annotation.SuppressLint
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
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
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.util.Locale

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

    private val audioPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            webView.post {
                webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('mtb-media-permission-granted'));",
                    null
                )
            }
        }
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ -> }

    private fun resolveFriendlyDeviceName(): String {
        val customName = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) {
                Settings.Global.getString(contentResolver, Settings.Global.DEVICE_NAME)
            } else {
                Settings.Global.getString(contentResolver, "device_name")
            }
        } catch (_: Exception) {
            null
        }
        if (!customName.isNullOrBlank()) {
            return customName.trim()
        }

        val manufacturer = (Build.MANUFACTURER ?: "").trim()
        val model = (Build.MODEL ?: "").trim()
        if (model.isEmpty()) return "Android Thiết bị"
        return if (model.lowercase(Locale.ROOT).startsWith(manufacturer.lowercase(Locale.ROOT))) {
            model
        } else {
            val prettyMfg = manufacturer.replaceFirstChar {
                if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString()
            }
            "$prettyMfg $model".trim()
        }
    }

    private fun resolveBluetoothSpeakerName(): String {
        return try {
            val am = getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return ""
            val outputs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            for (dev in outputs) {
                val isBt = dev.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                    dev.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                    (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                        (dev.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
                            dev.type == AudioDeviceInfo.TYPE_BLE_SPEAKER))
                if (isBt) {
                    val label = dev.productName?.toString()?.trim()
                    if (!label.isNullOrBlank()) return label
                }
            }
            ""
        } catch (_: Exception) {
            ""
        }
    }

    private fun updateBackgroundService(active: Boolean, title: String, subtitle: String) {
        try {
            if (active) {
                val intent = Intent(this, AudioBackgroundService::class.java).apply {
                    action = AudioBackgroundService.ACTION_START_OR_UPDATE
                    putExtra(AudioBackgroundService.EXTRA_TITLE, title)
                    putExtra(AudioBackgroundService.EXTRA_SUBTITLE, subtitle)
                }
                ContextCompat.startForegroundService(this, intent)
            } else {
                val intent = Intent(this, AudioBackgroundService::class.java).apply {
                    action = AudioBackgroundService.ACTION_STOP
                }
                startService(intent)
            }
        } catch (_: Exception) {
        }
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

        @JavascriptInterface
        fun getDeviceName(): String = resolveFriendlyDeviceName()

        @JavascriptInterface
        fun getBluetoothSpeakerName(): String = resolveBluetoothSpeakerName()

        @JavascriptInterface
        fun setBackgroundPlayback(active: Boolean, title: String, subtitle: String) {
            runOnUiThread {
                updateBackgroundService(active, title, subtitle)
            }
        }

        @JavascriptInterface
        fun scanDeviceMusic(): String {
            val permission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                Manifest.permission.READ_MEDIA_AUDIO
            } else {
                Manifest.permission.READ_EXTERNAL_STORAGE
            }

            if (ContextCompat.checkSelfPermission(this@MainActivity, permission) != PackageManager.PERMISSION_GRANTED) {
                runOnUiThread {
                    audioPermissionLauncher.launch(permission)
                }
                return JSONObject().put("needsPermission", true).put("tracks", JSONArray()).toString()
            }

            val tracks = queryDeviceAudioMediaStore()
            return JSONObject().put("needsPermission", false).put("tracks", tracks).toString()
        }
    }

    private fun queryDeviceAudioMediaStore(): JSONArray {
        val result = JSONArray()
        val collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        val projection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.DATA,
            MediaStore.Audio.Media.ALBUM_ID
        )
        val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0 OR ${MediaStore.Audio.Media.DURATION} > 5000"
        val sortOrder = "${MediaStore.Audio.Media.DATE_ADDED} DESC"
        val albumArtCache = HashMap<Long, String>()

        try {
            contentResolver.query(collection, projection, selection, null, sortOrder)?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                val titleCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
                val artistCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
                val durCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
                val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)
                val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
                val dataCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATA)
                val albumIdCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)

                var count = 0
                while (cursor.moveToNext() && count < 400) {
                    val id = cursor.getLong(idCol)
                    val displayName = cursor.getString(nameCol) ?: "track_$id.mp3"
                    val ext = displayName.substringAfterLast('.', "").lowercase()
                    if (ext !in listOf("mp3", "flac", "wav", "m4a", "aac", "ogg", "opus", "webm")) {
                        continue
                    }

                    val title = cursor.getString(titleCol)?.takeIf { it.isNotBlank() }
                        ?: displayName.substringBeforeLast('.')
                    val artist = cursor.getString(artistCol)?.takeIf { it.isNotBlank() && it != "<unknown>" }
                        ?: "Nhạc trên thiết bị"
                    val durationSec = (cursor.getLong(durCol) / 1000.0).coerceAtLeast(1.0)
                    val sizeBytes = cursor.getLong(sizeCol)
                    val filePath = cursor.getString(dataCol) ?: ""
                    val folderName = extractParentFolderName(filePath)
                    val albumId = cursor.getLong(albumIdCol)

                    val coverUrl = albumArtCache.getOrPut(albumId) {
                        loadAlbumArtDataUrl(albumId)
                    }

                    val formatCategory = when (ext) {
                        "mp3" -> "MP3"
                        "flac" -> "FLAC"
                        "wav" -> "WAV"
                        "m4a", "aac" -> "M4A"
                        "ogg", "opus" -> "OGG"
                        else -> "KHÁC"
                    }

                    result.put(JSONObject().apply {
                        put("id", "media-$id")
                        put("title", title)
                        put("artist", artist)
                        put("folderName", folderName)
                        put("formatCategory", formatCategory)
                        put("durationSec", durationSec)
                        put("fileSizeBytes", sizeBytes)
                        put("localMediaUrl", "https://appassets.androidplatform.net/local-media/$id")
                        put("coverUrl", coverUrl)
                    })
                    count++
                }
            }
        } catch (_: Exception) {
        }
        return result
    }

    private fun extractParentFolderName(fullPath: String): String {
        if (fullPath.isBlank()) return "Nhạc trên máy"
        val normalized = fullPath.replace('\\', '/')
        val lastSlash = normalized.lastIndexOf('/')
        if (lastSlash <= 0) return "Nhạc trên máy"
        val parentPath = normalized.substring(0, lastSlash)
        val parentName = parentPath.substringAfterLast('/')
        return parentName.ifBlank { "Nhạc trên máy" }
    }

    private fun loadAlbumArtDataUrl(albumId: Long): String {
        if (albumId <= 0) return ""
        return try {
            val artUri = ContentUris.withAppendedId(
                Uri.parse("content://media/external/audio/albumart"),
                albumId
            )
            contentResolver.openInputStream(artUri)?.use { stream ->
                val buffer = ByteArrayOutputStream()
                val chunk = ByteArray(8192)
                var total = 0
                while (true) {
                    val read = stream.read(chunk)
                    if (read == -1) break
                    total += read
                    if (total > 260_000) break
                    buffer.write(chunk, 0, read)
                }
                val b64 = Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP)
                "data:image/jpeg;base64,$b64"
            } ?: ""
        } catch (_: Exception) {
            ""
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        acquireWifiMulticastLock()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        // Start foreground service immediately so Wi-Fi server and audio continue seamlessly in background
        val initTitle = if (BuildConfig.APP_ROLE == "host") {
            "MusicToBlutooth Truyền sẵn sàng"
        } else {
            "MusicToBlutooth Nhận sẵn sàng"
        }
        updateBackgroundService(true, initTitle, "Chạy nền qua Wi-Fi ổn định")

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
            .addPathHandler("/local-media/") { path ->
                val mediaId = path.trimStart('/').toLongOrNull() ?: return@addPathHandler null
                try {
                    val uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, mediaId)
                    val mime = contentResolver.getType(uri) ?: "audio/mpeg"
                    val stream = contentResolver.openInputStream(uri) ?: return@addPathHandler null
                    WebResourceResponse(mime, null, stream)
                } catch (_: Exception) {
                    null
                }
            }
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

    override fun onResume() {
        super.onResume()
        // Ensure WebView timers stay active
        if (::webView.isInitialized) {
            webView.onResume()
            webView.resumeTimers()
        }
    }

    override fun onPause() {
        // Intentionally do NOT call webView.onPause() or webView.pauseTimers()
        // so background Wi-Fi audio streaming and receiving continue uninterrupted.
        super.onPause()
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
        updateBackgroundService(false, "", "")
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
