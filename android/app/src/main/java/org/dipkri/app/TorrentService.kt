package org.dipkri.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import java.io.OutputStream
import java.security.SecureRandom
import kotlin.concurrent.thread

/**
 * Keeps the local torrent endpoint alive while the app is in the background, so
 * playback continues when the screen turns off. The service owns the token and
 * the cache directory; nothing leaves the device except the swarm traffic.
 */
class TorrentService : Service() {

    private var server: LocalHttpServer? = null
    private var engine: TorrentEngine = PlaceholderEngine()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        token = ByteArray(24).also { SecureRandom().nextBytes(it) }
            .joinToString("") { "%02x".format(it) }

        startForeground(NOTIFICATION_ID, buildNotification())

        // If libtorrent cannot start on this ABI the app keeps working: ready
        // stays false and the web build streams from the server instead.
        val torrentDir = java.io.File(cacheDir, "torrents").apply { mkdirs() }
        engine = try {
            val real = LibtorrentEngine(this, torrentDir)
            if (real.start()) real else PlaceholderEngine()
        } catch (e: Throwable) {
            // UnsatisfiedLinkError / SO load failures must not crash the app
            android.util.Log.w("dipkri", "torrent engine unavailable: ${e.message}")
            PlaceholderEngine()
        }
        server = LocalHttpServer(
            port = LocalHttpServer.DEFAULT_PORT,
            token = token,
            engine = engine,
            onRoomEnd = { clearCache() },
        ).also { srv ->
            thread(name = "dipkri-service-start") {
                try {
                    srv.start()
                    port = LocalHttpServer.DEFAULT_PORT
                } catch (e: Exception) {
                    port = 0
                }
            }
        }
    }

    override fun onDestroy() {
        server?.stop()
        engine.stopAll()
        clearCache()
        instance = null
        port = 0
        super.onDestroy()
    }

    private fun clearCache() {
        val dir = java.io.File(cacheDir, "torrents")
        if (dir.exists()) dir.deleteRecursively()
        dir.mkdirs()
    }

    private fun buildNotification(): Notification {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Playback",
                NotificationManager.IMPORTANCE_LOW,
            )
            manager.createNotificationChannel(channel)
        }
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle("dipkri")
            .setContentText("Streaming on this device")
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setOngoing(true)
            .build()
    }

    /** JSON the WebView bridge hands to the page. */
    fun sidecarJson(): String {
        // ready only when the engine can actually serve bytes; until then the web
        // app keeps streaming from the server instead of hitting a 501 locally.
        val ready = port > 0 && engine.ready
        val url = if (ready) "http://127.0.0.1:$port" else ""
        return """{"url":"$url","token":"$token","ready":$ready}"""
    }

    private class PlaceholderEngine : TorrentEngine {
        override val name = "placeholder"
        override val ready = false
        override fun torrentCount() = 0
        override fun serve(magnet: String, fileIndex: Int?, range: String?, out: OutputStream) {
            // replaced by the libtorrent4j engine
        }
        override fun stopAll() {}
    }

    companion object {
        private const val CHANNEL_ID = "dipkri_playback"
        private const val NOTIFICATION_ID = 4711

        @Volatile private var instance: TorrentService? = null
        @Volatile private var port: Int = 0
        @Volatile private var token: String = ""

        fun start(context: Context) {
            val intent = Intent(context, TorrentService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun sidecarJson(): String = instance?.sidecarJson()
            ?: """{"url":"","token":"","ready":false}"""
    }
}
