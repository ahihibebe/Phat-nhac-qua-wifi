package com.musictoblutooth

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.os.Process
import androidx.core.app.NotificationCompat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.pow

class MediaCaptureService : Service() {

    companion object {
        const val CHANNEL_ID = "mtb_media_capture_channel"
        const val NOTIFICATION_ID = 1049
        const val ACTION_START = "com.musictoblutooth.CAPTURE_START"
        const val ACTION_STOP = "com.musictoblutooth.CAPTURE_STOP"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_DATA = "result_data"

        @Volatile
        var isRunning = false
        @Volatile
        var isAudioStreaming = false
        @Volatile
        var jitterBufferMs = 80
        @Volatile
        var channelMode = "stereo"
        @Volatile
        var roomId = "MB48"
        @Volatile
        var telemetryListener: ((capturing: Boolean, streaming: Boolean, kbps: Int, packetsSent: Long, bandsJson: String) -> Unit)? = null
    }

    private var mediaProjection: MediaProjection? = null
    private var audioRecord: AudioRecord? = null
    private var captureThread: Thread? = null
    @Volatile
    private var capturing = false
    private var seqCounter = 1
    private var totalPacketsSent: Long = 0

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    @Suppress("DEPRECATION")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopCapture()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
            ?: Activity.RESULT_CANCELED
        val resultData: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent?.getParcelableExtra(EXTRA_DATA, Intent::class.java)
        } else {
            intent?.getParcelableExtra(EXTRA_DATA)
        }

        if (resultCode == Activity.RESULT_OK && resultData != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startInternalAudioCapture(resultCode, resultData)
        } else {
            stopSelf()
        }

        return START_NOT_STICKY
    }

    @SuppressLint("MissingPermission")
    private fun startInternalAudioCapture(resultCode: Int, resultData: Intent) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        stopCapture()

        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val projection = mpm.getMediaProjection(resultCode, resultData) ?: return
        mediaProjection = projection

        val sampleRate = 48000
        val frameSamples = 960 // 20 ms at 48 kHz
        val channels = 2
        val bytesPerFrame = frameSamples * channels * 2 // 3840 bytes

        val config = AudioPlaybackCaptureConfiguration.Builder(projection)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .excludeUid(Process.myUid())
            .build()

        val audioFormat = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(sampleRate)
            .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
            .build()

        val minBuf = AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_STEREO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        val bufferSize = maxOf(minBuf, bytesPerFrame * 4)

        val record = AudioRecord.Builder()
            .setAudioFormat(audioFormat)
            .setBufferSizeInBytes(bufferSize)
            .setAudioPlaybackCaptureConfig(config)
            .build()

        if (record.state != AudioRecord.STATE_INITIALIZED) {
            record.release()
            projection.stop()
            return
        }

        audioRecord = record
        capturing = true
        isRunning = true
        record.startRecording()

        captureThread = Thread {
            Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
            val pcmShorts = ShortArray(frameSamples * channels)
            var lastSoundAtMs = 0L
            var lastUiPushMs = 0L
            var windowBytes = 0L
            var windowStartMs = System.currentTimeMillis()
            var lastStreamBroadcastState = false

            while (capturing) {
                val readShorts = record.read(pcmShorts, 0, pcmShorts.size, AudioRecord.READ_BLOCKING)
                if (readShorts < pcmShorts.size) {
                    if (readShorts < 0) break
                    continue
                }

                var peak = 0
                for (s in pcmShorts) {
                    val a = abs(s.toInt())
                    if (a > peak) peak = a
                }

                val nowMs = System.currentTimeMillis()
                if (peak > 45) {
                    lastSoundAtMs = nowMs
                }
                val activeNow = (nowMs - lastSoundAtMs) <= 1300L
                isAudioStreaming = activeNow

                if (activeNow != lastStreamBroadcastState) {
                    lastStreamBroadcastState = activeNow
                    LocalWifiServer.activeInstance?.updateHostMediaStatus(
                        roomId,
                        activeNow,
                        if (activeNow) "Âm thanh Media trên thiết bị" else "Đang chờ phát Media..."
                    )
                }

                if (activeNow) {
                    val mode = channelMode
                    val packetBuf = ByteBuffer.allocate(24 + bytesPerFrame).order(ByteOrder.LITTLE_ENDIAN)
                    val seq = seqCounter++
                    val flags = 0x01 // stereo 2ch
                    val playAtServerMs = (nowMs + jitterBufferMs).toDouble()

                    packetBuf.put(0x4d.toByte())
                    packetBuf.put(0x42.toByte())
                    packetBuf.put(1.toByte())
                    packetBuf.put(flags.toByte())
                    packetBuf.putInt(seq)
                    packetBuf.putDouble(playAtServerMs)
                    packetBuf.putInt(sampleRate)
                    packetBuf.putShort(frameSamples.toShort())
                    packetBuf.putShort(0)

                    var checksum = (seq xor sampleRate xor frameSamples xor flags) and 0xffff
                    for (i in 0 until frameSamples) {
                        val lRaw = pcmShorts[i * 2].toInt()
                        val rRaw = pcmShorts[i * 2 + 1].toInt()
                        val lOut: Short
                        val rOut: Short
                        when (mode) {
                            "left" -> {
                                lOut = lRaw.toShort()
                                rOut = lOut
                            }
                            "right" -> {
                                rOut = rRaw.toShort()
                                lOut = rOut
                            }
                            "mono" -> {
                                val m = ((lRaw + rRaw) / 2).toShort()
                                lOut = m
                                rOut = m
                            }
                            else -> {
                                lOut = lRaw.toShort()
                                rOut = rRaw.toShort()
                            }
                        }
                        packetBuf.putShort(lOut)
                        packetBuf.putShort(rOut)
                        if ((i and 15) == 0) {
                            checksum = (checksum + (lOut.toInt() and 0xffff)) and 0xffff
                        }
                    }
                    packetBuf.putShort(22, checksum.toShort())

                    val packetBytes = packetBuf.array()
                    LocalWifiServer.activeInstance?.broadcastNativeHostPcm(packetBytes, roomId)
                    totalPacketsSent++
                    windowBytes += packetBytes.size
                }

                if (nowMs - lastUiPushMs >= 110L) {
                    lastUiPushMs = nowMs
                    val elapsed = maxOf(1L, nowMs - windowStartMs)
                    val kbps = if (activeNow) ((windowBytes * 8) / elapsed).toInt() else 0
                    if (elapsed >= 1000L) {
                        windowBytes = 0
                        windowStartMs = nowMs
                    }

                    val bands = StringBuilder("[")
                    val step = frameSamples / 32
                    for (b in 0 until 32) {
                        var sum = 0.0
                        for (k in 0 until step) {
                            val idx = (b * step + k) * 2
                            sum += (abs(pcmShorts[idx].toInt()) + abs(pcmShorts[idx + 1].toInt())) / 65536.0
                        }
                        val avg = sum / step
                        val amp = if (activeNow) min(1.0, (avg * 3.0).pow(0.72)) else 0.0
                        if (b > 0) bands.append(",")
                        bands.append(String.format(java.util.Locale.US, "%.3f", amp))
                    }
                    bands.append("]")

                    telemetryListener?.invoke(true, activeNow, kbps, totalPacketsSent, bands.toString())
                }
            }
        }.apply { start() }
    }

    private fun stopCapture() {
        capturing = false
        isRunning = false
        isAudioStreaming = false
        try { captureThread?.join(350) } catch (_: Exception) {}
        captureThread = null
        try { audioRecord?.stop() } catch (_: Exception) {}
        try { audioRecord?.release() } catch (_: Exception) {}
        audioRecord = null
        try { mediaProjection?.stop() } catch (_: Exception) {}
        mediaProjection = null
        telemetryListener?.invoke(false, false, 0, totalPacketsSent, "[]")
    }

    private fun buildNotification(): Notification {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(
            this,
            1,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Đang tự thu & truyền Media trên máy")
            .setContentText("Âm thanh từ các ứng dụng phát nhạc sẽ tự truyền qua Wi-Fi")
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pi)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                "Tự thu & truyền Media trên máy",
                NotificationManager.IMPORTANCE_LOW
            )
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(ch)
        }
    }

    override fun onDestroy() {
        stopCapture()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
