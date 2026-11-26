package com.musictoblutooth

import android.content.Context
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.min
import kotlin.math.sin

class LocalWifiServer(
    private val context: Context,
    val port: Int = 8765,
    private val discoveryPort: Int = 49153
) {
    private val executor = Executors.newCachedThreadPool()
    private var serverSocket: ServerSocket? = null
    private var beaconSocket: DatagramSocket? = null
    @Volatile
    private var running = false
    @Volatile
    var activeRoomId: String = "MB48"

    data class ReceiverState(
        val id: String,
        var name: String,
        var speakerLabel: String,
        var volume: Double = 1.0,
        var muted: Boolean = false,
        var delayOffsetMs: Int = 0,
        var channelMode: String = "stereo",
        var rttMs: Int = 0,
        var bufferMs: Int = 0,
        var packetsReceived: Long = 0,
        var packetsDropped: Long = 0,
        var audioReady: Boolean = false,
        var outputDeviceLabel: String = "Mặc định / Loa Bluetooth",
        val connectedAt: Long = System.currentTimeMillis(),
        var lastSeenAt: Long = System.currentTimeMillis()
    ) {
        fun toJson(): JSONObject = JSONObject().apply {
            put("id", id)
            put("name", name)
            put("speakerLabel", speakerLabel)
            put("volume", volume)
            put("muted", muted)
            put("delayOffsetMs", delayOffsetMs)
            put("channelMode", channelMode)
            put("rttMs", rttMs)
            put("bufferMs", bufferMs)
            put("packetsReceived", packetsReceived)
            put("packetsDropped", packetsDropped)
            put("audioReady", audioReady)
            put("outputDeviceLabel", outputDeviceLabel)
            put("connectedAt", connectedAt)
            put("lastSeenAt", lastSeenAt)
        }
    }

    data class WsClient(
        val id: String,
        val socket: Socket,
        val out: OutputStream,
        var roomId: String = "MB48",
        var role: String = "receiver"
    ) {
        private val writeLock = Any()

        fun sendFrame(opcode: Int, payload: ByteArray) {
            synchronized(writeLock) {
                try {
                    val len = payload.size
                    val header = ByteArrayOutputStream()
                    header.write(0x80 or (opcode and 0x0f))
                    when {
                        len <= 125 -> header.write(len)
                        len <= 65535 -> {
                            header.write(126)
                            header.write((len shr 8) and 0xff)
                            header.write(len and 0xff)
                        }
                        else -> {
                            header.write(127)
                            val b = ByteBuffer.allocate(8).putLong(len.toLong()).array()
                            header.write(b)
                        }
                    }
                    out.write(header.toByteArray())
                    out.write(payload)
                    out.flush()
                } catch (_: Exception) {
                }
            }
        }

        fun sendText(text: String) {
            sendFrame(0x1, text.toByteArray(Charsets.UTF_8))
        }

        fun sendBinary(data: ByteArray) {
            sendFrame(0x2, data)
        }
    }

    private val clients = ConcurrentHashMap<String, WsClient>()
    private val receivers = ConcurrentHashMap<String, ReceiverState>()
    private val roomSettings = ConcurrentHashMap<String, JSONObject>()
    private val roomHosts = ConcurrentHashMap<String, String>()

    fun start() {
        if (running) return
        running = true

        executor.execute {
            try {
                serverSocket = ServerSocket(port, 50, InetAddress.getByName("0.0.0.0"))
                while (running) {
                    val clientSocket = serverSocket?.accept() ?: break
                    clientSocket.tcpNoDelay = true
                    executor.execute { handleConnection(clientSocket) }
                }
            } catch (_: Exception) {
            }
        }

        // Broadcast Wi-Fi LAN discovery beacon so Receiver APKs find this Transmitter automatically
        executor.execute {
            try {
                val sock = DatagramSocket().apply { broadcast = true }
                beaconSocket = sock
                val broadcastAddr = InetAddress.getByName("255.255.255.255")
                while (running) {
                    val ip = getLocalIpv4Address()
                    if (ip != null) {
                        val msg = "MTB_HOST|$ip|$port|$activeRoomId".toByteArray(Charsets.UTF_8)
                        val packet = DatagramPacket(msg, msg.size, broadcastAddr, discoveryPort)
                        try {
                            sock.send(packet)
                        } catch (_: Exception) {
                        }
                    }
                    Thread.sleep(2000)
                }
            } catch (_: Exception) {
            }
        }
    }

    fun stop() {
        running = false
        try { serverSocket?.close() } catch (_: Exception) {}
        try { beaconSocket?.close() } catch (_: Exception) {}
        for (c in clients.values) {
            try { c.socket.close() } catch (_: Exception) {}
        }
        clients.clear()
        receivers.clear()
    }

    fun getLocalIpv4Address(): String? {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces() ?: return null
            for (intf in interfaces) {
                if (!intf.isUp || intf.isLoopback) continue
                for (addr in intf.inetAddresses) {
                    if (!addr.isLoopbackAddress && addr is Inet4Address) {
                        val ip = addr.hostAddress ?: continue
                        if (!ip.startsWith("169.254.")) {
                            return ip
                        }
                    }
                }
            }
        } catch (_: Exception) {
        }
        return null
    }

    private fun handleConnection(socket: Socket) {
        val input = BufferedInputStream(socket.getInputStream())
        val out = socket.getOutputStream()

        try {
            val headers = readHttpHeaders(input) ?: run {
                socket.close()
                return
            }
            val requestLine = headers.firstOrNull() ?: run {
                socket.close()
                return
            }
            val parts = requestLine.split(" ")
            if (parts.size < 2) {
                socket.close()
                return
            }
            val rawPath = parts[1].substringBefore("?")

            val wsKeyLine = headers.firstOrNull { it.startsWith("Sec-WebSocket-Key:", ignoreCase = true) }
            if (rawPath == "/ws" && wsKeyLine != null) {
                val key = wsKeyLine.substringAfter(":").trim()
                val accept = computeWsAccept(key)
                val handshake = (
                    "HTTP/1.1 101 Switching Protocols\r\n" +
                        "Upgrade: websocket\r\n" +
                        "Connection: Upgrade\r\n" +
                        "Sec-WebSocket-Accept: $accept\r\n\r\n"
                    ).toByteArray(Charsets.UTF_8)
                out.write(handshake)
                out.flush()
                handleWebSocketLoop(socket, input, out)
            } else {
                handleHttpRequest(rawPath, out)
                socket.close()
            }
        } catch (_: Exception) {
            try { socket.close() } catch (_: Exception) {}
        }
    }

    private fun handleHttpRequest(rawPath: String, out: OutputStream) {
        if (rawPath == "/api/health") {
            writeHttpJson(out, "{\"ok\":true,\"serverTimeMs\":${System.currentTimeMillis()}}")
            return
        }
        if (rawPath == "/api/network-info") {
            val ip = getLocalIpv4Address()
            val arr = JSONArray()
            val urls = JSONArray()
            if (ip != null) {
                arr.put(ip)
                urls.put("http://$ip:$port")
            }
            val json = JSONObject().apply {
                put("lanIps", arr)
                put("port", port)
                put("suggestedUrls", urls)
                put("originUrl", if (ip != null) "http://$ip:$port" else "http://127.0.0.1:$port")
            }
            writeHttpJson(out, json.toString())
            return
        }

        val cleanPath = if (rawPath == "/" || rawPath.isEmpty()) "index.html" else rawPath.trimStart('/')
        val assetPath = "www/$cleanPath"
        val assetBytes = readAssetOrFallback(assetPath)
        if (assetBytes == null) {
            val body = "Not Found".toByteArray(Charsets.UTF_8)
            out.write(("HTTP/1.1 404 Not Found\r\nContent-Length: ${body.size}\r\n\r\n").toByteArray())
            out.write(body)
            out.flush()
            return
        }

        val mime = guessMimeType(cleanPath)
        val header = (
            "HTTP/1.1 200 OK\r\n" +
                "Content-Type: $mime\r\n" +
                "Content-Length: ${assetBytes.size}\r\n" +
                "Cache-Control: no-cache\r\n" +
                "Connection: close\r\n\r\n"
            ).toByteArray(Charsets.UTF_8)
        out.write(header)
        out.write(assetBytes)
        out.flush()
    }

    private fun readAssetOrFallback(assetPath: String): ByteArray? {
        return try {
            context.assets.open(assetPath).use { it.readBytes() }
        } catch (_: Exception) {
            if (!assetPath.contains(".")) {
                try {
                    context.assets.open("www/index.html").use { it.readBytes() }
                } catch (_: Exception) {
                    null
                }
            } else {
                null
            }
        }
    }

    private fun writeHttpJson(out: OutputStream, json: String) {
        val bytes = json.toByteArray(Charsets.UTF_8)
        val header = (
            "HTTP/1.1 200 OK\r\n" +
                "Content-Type: application/json; charset=utf-8\r\n" +
                "Access-Control-Allow-Origin: *\r\n" +
                "Content-Length: ${bytes.size}\r\n" +
                "Connection: close\r\n\r\n"
            ).toByteArray(Charsets.UTF_8)
        out.write(header)
        out.write(bytes)
        out.flush()
    }

    private fun handleWebSocketLoop(socket: Socket, rawIn: InputStream, out: OutputStream) {
        val clientId = "and-${java.util.UUID.randomUUID().toString().take(6)}"
        val client = WsClient(clientId, socket, out)
        clients[clientId] = client
        val dis = DataInputStream(rawIn)

        try {
            while (running && !socket.isClosed) {
                val b0 = dis.read()
                if (b0 == -1) break
                val b1 = dis.read()
                if (b1 == -1) break

                val opcode = b0 and 0x0f
                val masked = (b1 and 0x80) != 0
                var payloadLen = (b1 and 0x7f).toLong()
                if (payloadLen == 126L) {
                    payloadLen = dis.readUnsignedShort().toLong()
                } else if (payloadLen == 127L) {
                    payloadLen = dis.readLong()
                }

                val maskKey = if (masked) ByteArray(4).also { dis.readFully(it) } else null
                if (payloadLen < 0 || payloadLen > 4 * 1024 * 1024) break

                val payload = ByteArray(payloadLen.toInt())
                if (payloadLen > 0) {
                    dis.readFully(payload)
                    if (maskKey != null) {
                        for (i in payload.indices) {
                            payload[i] = (payload[i].toInt() xor maskKey[i % 4].toInt()).toByte()
                        }
                    }
                }

                when (opcode) {
                    0x8 -> break // Close
                    0x9 -> client.sendFrame(0xA, payload) // Pong
                    0x2 -> {
                        // Binary PCM frame from host -> relay to all non-muted receivers in room
                        if (client.role == "host") {
                            for (target in clients.values) {
                                if (target.role == "receiver" && target.roomId == client.roomId) {
                                    val rec = receivers[target.id]
                                    if (rec != null && !rec.muted) {
                                        target.sendBinary(payload)
                                    }
                                }
                            }
                        }
                    }
                    0x1 -> {
                        val text = String(payload, Charsets.UTF_8)
                        handleJsonMessage(client, text)
                    }
                }
            }
        } catch (_: Exception) {
        } finally {
            clients.remove(clientId)
            receivers.remove(clientId)
            if (roomHosts[client.roomId] == clientId) {
                roomHosts.remove(client.roomId)
                val disc = JSONObject().put("type", "host:disconnected").toString()
                for (c in clients.values) {
                    if (c.roomId == client.roomId) c.sendText(disc)
                }
            }
            broadcastRoomState(client.roomId)
            try { socket.close() } catch (_: Exception) {}
        }
    }

    private fun handleJsonMessage(client: WsClient, text: String) {
        val msg = try { JSONObject(text) } catch (_: Exception) { return }
        when (msg.optString("type")) {
            "sync:ping" -> {
                val pong = JSONObject().apply {
                    put("type", "sync:pong")
                    put("clientSendMs", msg.optLong("clientSendMs"))
                    put("serverTimeMs", System.currentTimeMillis())
                }.toString()
                client.sendText(pong)
            }
            "room:join" -> {
                val roomId = msg.optString("roomId", "MB48").trim().uppercase().ifEmpty { "MB48" }
                val role = msg.optString("role", "receiver")
                client.roomId = roomId
                client.role = role
                activeRoomId = roomId

                roomSettings.putIfAbsent(roomId, JSONObject().apply {
                    put("sampleRate", 48000)
                    put("frameDurationMs", 20)
                    put("jitterBufferMs", 80)
                    put("isPlaying", false)
                    put("trackTitle", "Chưa chọn bản nhạc")
                    put("trackPositionSec", 0)
                    put("trackDurationSec", 0)
                })

                if (role == "host") {
                    roomHosts[roomId] = client.id
                } else {
                    val idx = receivers.values.count { clients[it.id]?.roomId == roomId } + 1
                    val dev = ReceiverState(
                        id = client.id,
                        name = msg.optString("deviceName").ifBlank { "Điện thoại #$idx" },
                        speakerLabel = msg.optString("speakerLabel").ifBlank { "Loa Bluetooth $idx" }
                    )
                    receivers[client.id] = dev
                    val cfgMsg = JSONObject().apply {
                        put("type", "device:config")
                        put("device", dev.toJson())
                    }.toString()
                    client.sendText(cfgMsg)
                }
                broadcastRoomState(roomId)
            }
            "host:settings" -> {
                if (client.role != "host") return
                val cur = roomSettings[client.roomId] ?: JSONObject()
                val patch = msg.optJSONObject("settings") ?: return
                val keys = patch.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    cur.put(k, patch.get(k))
                }
                roomSettings[client.roomId] = cur
                val outMsg = JSONObject().apply {
                    put("type", "room:settings")
                    put("settings", cur)
                }.toString()
                for (c in clients.values) {
                    if (c.roomId == client.roomId && c.id != client.id) {
                        c.sendText(outMsg)
                    }
                }
            }
            "host:update-device" -> {
                if (client.role != "host") return
                val targetId = msg.optString("receiverId")
                val dev = receivers[targetId] ?: return
                val patch = msg.optJSONObject("patch") ?: return
                if (patch.has("name")) dev.name = patch.optString("name", dev.name)
                if (patch.has("speakerLabel")) dev.speakerLabel = patch.optString("speakerLabel", dev.speakerLabel)
                if (patch.has("volume")) dev.volume = patch.optDouble("volume", dev.volume)
                if (patch.has("muted")) dev.muted = patch.optBoolean("muted", dev.muted)
                if (patch.has("delayOffsetMs")) dev.delayOffsetMs = patch.optInt("delayOffsetMs", dev.delayOffsetMs)
                if (patch.has("channelMode")) dev.channelMode = patch.optString("channelMode", dev.channelMode)

                clients[targetId]?.sendText(
                    JSONObject().apply {
                        put("type", "device:config")
                        put("device", dev.toJson())
                    }.toString()
                )
                broadcastRoomState(client.roomId)
            }
            "host:kick-device" -> {
                if (client.role != "host") return
                val targetId = msg.optString("receiverId")
                clients.remove(targetId)?.let { try { it.socket.close() } catch (_: Exception) {} }
                receivers.remove(targetId)
                broadcastRoomState(client.roomId)
            }
            "host:test-tone" -> {
                if (client.role != "host") return
                val targetId = msg.optString("receiverId")
                val target = clients[targetId] ?: return
                sendCalibrationTone(target, client.roomId)
            }
            "receiver:telemetry" -> {
                val dev = receivers[client.id] ?: return
                dev.rttMs = msg.optInt("rttMs", dev.rttMs)
                dev.bufferMs = msg.optInt("bufferMs", dev.bufferMs)
                dev.packetsReceived = msg.optLong("packetsReceived", dev.packetsReceived)
                dev.packetsDropped = msg.optLong("packetsDropped", dev.packetsDropped)
                dev.audioReady = msg.optBoolean("audioReady", dev.audioReady)
                dev.outputDeviceLabel = msg.optString("outputDeviceLabel", dev.outputDeviceLabel)
                dev.lastSeenAt = System.currentTimeMillis()
                broadcastRoomState(client.roomId)
            }
            "receiver:update-self" -> {
                val dev = receivers[client.id] ?: return
                if (msg.has("name")) dev.name = msg.optString("name", dev.name)
                if (msg.has("speakerLabel")) dev.speakerLabel = msg.optString("speakerLabel", dev.speakerLabel)
                if (msg.has("volume")) dev.volume = msg.optDouble("volume", dev.volume)
                if (msg.has("muted")) dev.muted = msg.optBoolean("muted", dev.muted)
                if (msg.has("delayOffsetMs")) dev.delayOffsetMs = msg.optInt("delayOffsetMs", dev.delayOffsetMs)
                client.sendText(
                    JSONObject().apply {
                        put("type", "device:config")
                        put("device", dev.toJson())
                    }.toString()
                )
                broadcastRoomState(client.roomId)
            }
        }
    }

    private fun broadcastRoomState(roomId: String) {
        val recArr = JSONArray()
        for (c in clients.values) {
            if (c.roomId == roomId && c.role == "receiver") {
                receivers[c.id]?.let { recArr.put(it.toJson()) }
            }
        }
        val state = JSONObject().apply {
            put("type", "room:state")
            put("roomId", roomId)
            put("receivers", recArr)
            put("settings", roomSettings[roomId] ?: JSONObject())
            put("hostConnected", roomHosts.containsKey(roomId))
        }.toString()

        for (c in clients.values) {
            if (c.roomId == roomId) c.sendText(state)
        }
    }

    private fun sendCalibrationTone(target: WsClient, roomId: String) {
        val sr = roomSettings[roomId]?.optInt("sampleRate", 48000) ?: 48000
        val frameMs = 20
        val frameSamples = (sr * frameMs) / 1000
        val totalFrames = 20
        val basePlayMs = (System.currentTimeMillis() + 80).toDouble()

        for (f in 0 until totalFrames) {
            val buf = ByteBuffer.allocate(24 + frameSamples * 4).order(ByteOrder.LITTLE_ENDIAN)
            val seq = 900000 + f
            val flags = 0x03
            buf.put(0x4d.toByte())
            buf.put(0x42.toByte())
            buf.put(1.toByte())
            buf.put(flags.toByte())
            buf.putInt(seq)
            buf.putDouble(basePlayMs + f * frameMs)
            buf.putInt(sr)
            buf.putShort(frameSamples.toShort())
            buf.putShort(0)

            var checksum = (seq xor sr xor frameSamples xor flags) and 0xffff
            for (i in 0 until frameSamples) {
                val t = (f * frameSamples + i).toDouble() / sr
                val env = min(1.0, t / 0.015) * exp(-t * 7.5)
                val freq = if (t < 0.18) 880.0 else 1318.5
                val sample = (sin(2.0 * PI * freq * t) * env * 0.45 * 32767.0).toInt().toShort()
                buf.putShort(sample)
                buf.putShort(sample)
                if ((i and 15) == 0) {
                    checksum = (checksum + (sample.toInt() and 0xffff)) and 0xffff
                }
            }
            buf.putShort(22, checksum.toShort())
            target.sendBinary(buf.array())
        }
    }

    private fun readHttpHeaders(input: InputStream): List<String>? {
        val lines = mutableListOf<String>()
        val sb = StringBuilder()
        var prev = 0
        while (true) {
            val ch = input.read()
            if (ch == -1) return null
            if (ch == '\n'.code && prev == '\r'.code) {
                val line = sb.toString().trimEnd('\r')
                sb.setLength(0)
                if (line.isEmpty()) break
                lines.add(line)
            } else if (ch != '\r'.code) {
                sb.append(ch.toChar())
            }
            prev = ch
        }
        return lines
    }

    private fun computeWsAccept(key: String): String {
        val magic = "${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        val sha1 = MessageDigest.getInstance("SHA-1").digest(magic.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(sha1, Base64.NO_WRAP)
    }

    private fun guessMimeType(filePath: String): String {
        return when {
            filePath.endsWith(".html") -> "text/html; charset=utf-8"
            filePath.endsWith(".js") || filePath.endsWith(".mjs") -> "application/javascript; charset=utf-8"
            filePath.endsWith(".css") -> "text/css; charset=utf-8"
            filePath.endsWith(".json") -> "application/json; charset=utf-8"
            filePath.endsWith(".jpg") || filePath.endsWith(".jpeg") -> "image/jpeg"
            filePath.endsWith(".png") -> "image/png"
            filePath.endsWith(".svg") -> "image/svg+xml"
            else -> "application/octet-stream"
        }
    }
}
