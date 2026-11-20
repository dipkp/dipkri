package org.dipkri.app

import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * The Android twin of desktop/sidecar.mjs.
 *
 * Listens on 127.0.0.1 only, requires the per-launch token on everything except
 * /health, and serves Range requests so ExoPlayer can seek. The torrent engine
 * sits behind [TorrentEngine]; until it lands, /stream answers 501 with a clear
 * message instead of pretending.
 */
class LocalHttpServer(
    private val port: Int,
    private val token: String,
    private val engine: TorrentEngine,
    private val onRoomEnd: () -> Unit,
) {
    private val running = AtomicBoolean(false)
    private var socket: ServerSocket? = null

    fun start() {
        if (!running.compareAndSet(false, true)) return
        val server = ServerSocket()
        server.reuseAddress = true
        server.bind(InetSocketAddress("127.0.0.1", port))
        socket = server
        thread(name = "dipkri-http", isDaemon = true) {
            while (running.get()) {
                try {
                    handle(server.accept())
                } catch (e: Exception) {
                    if (running.get()) Thread.sleep(50)
                }
            }
        }
    }

    fun stop() {
        running.set(false)
        try {
            socket?.close()
        } catch (_: Exception) {
        }
        socket = null
    }

    private fun handle(client: Socket) {
        client.use { sock ->
            sock.soTimeout = 15_000
            val reader = BufferedReader(InputStreamReader(sock.getInputStream(), Charsets.ISO_8859_1))
            val requestLine = reader.readLine() ?: return
            val parts = requestLine.split(" ")
            if (parts.size < 2) return respond(sock.getOutputStream(), 400, """{"error":"bad request"}""")

            val method = parts[0]
            val target = parts[1]
            var rangeHeader: String? = null
            var providedToken: String? = null

            while (true) {
                val line = reader.readLine() ?: break
                if (line.isEmpty()) break
                val idx = line.indexOf(':')
                if (idx <= 0) continue
                val name = line.substring(0, idx).trim().lowercase()
                val value = line.substring(idx + 1).trim()
                when (name) {
                    "range" -> rangeHeader = value
                    "x-dipkri-token" -> providedToken = value
                }
            }

            val path = target.substringBefore('?')
            val query = parseQuery(target.substringAfter('?', ""))

            if (method == "OPTIONS") return respond(sock.getOutputStream(), 204, "")

            if (path == "/health") {
                return respond(
                    sock.getOutputStream(),
                    200,
                    """{"ok":true,"engine":"${engine.name}","ready":${engine.ready},"torrents":${engine.torrentCount()}}""",
                )
            }

            val supplied = providedToken ?: query["token"]
            if (supplied != token) return respond(sock.getOutputStream(), 401, """{"error":"bad token"}""")

            when {
                path == "/stream" && method == "GET" -> stream(sock.getOutputStream(), query, rangeHeader)
                path == "/room-end" && method == "POST" -> {
                    engine.stopAll()
                    onRoomEnd()
                    respond(sock.getOutputStream(), 200, """{"ok":true,"dropped":true}""")
                }
                else -> respond(sock.getOutputStream(), 404, """{"error":"not found"}""")
            }
        }
    }

    private fun stream(out: OutputStream, query: Map<String, String>, range: String?) {
        val magnet = query["torrent"]
        if (magnet == null || !magnet.startsWith("magnet:?")) {
            return respond(out, 400, """{"error":"invalid magnet"}""")
        }
        if (!engine.ready) {
            return respond(
                out,
                501,
                """{"error":"the torrent engine is not in this build yet"}""",
            )
        }
        engine.serve(magnet, query["fileIndex"]?.toIntOrNull(), range, out)
    }

    private fun parseQuery(raw: String): Map<String, String> =
        raw.split('&')
            .filter { it.contains('=') }
            .associate {
                val key = it.substringBefore('=')
                val value = java.net.URLDecoder.decode(it.substringAfter('='), "UTF-8")
                key to value
            }

    private fun respond(out: OutputStream, status: Int, body: String) {
        val bytes = body.toByteArray()
        val head = buildString {
            append("HTTP/1.1 $status ${statusText(status)}\r\n")
            append("Content-Type: application/json\r\n")
            append("Content-Length: ${bytes.size}\r\n")
            append("Access-Control-Allow-Origin: https://dipkri.duckdns.org\r\n")
            append("Connection: close\r\n\r\n")
        }
        out.write(head.toByteArray())
        if (bytes.isNotEmpty()) out.write(bytes)
        out.flush()
    }

    private fun statusText(status: Int): String = when (status) {
        200 -> "OK"
        204 -> "No Content"
        400 -> "Bad Request"
        401 -> "Unauthorized"
        404 -> "Not Found"
        501 -> "Not Implemented"
        else -> "Error"
    }

    companion object {
        const val DEFAULT_PORT = 17891
    }
}

/** The torrent engine boundary: libtorrent4j lands here in the next step. */
interface TorrentEngine {
    val name: String
    val ready: Boolean
    fun torrentCount(): Int
    fun serve(magnet: String, fileIndex: Int?, range: String?, out: OutputStream)
    fun stopAll()
}
