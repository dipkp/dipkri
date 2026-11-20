package org.dipkri.app

import android.content.Context
import org.libtorrent4j.Priority
import org.libtorrent4j.SessionManager
import org.libtorrent4j.SessionParams
import org.libtorrent4j.Sha1Hash
import org.libtorrent4j.TorrentHandle
import org.libtorrent4j.TorrentInfo
import org.libtorrent4j.swig.torrent_flags_t
import java.io.File
import java.io.OutputStream
import java.io.RandomAccessFile
import java.util.concurrent.ConcurrentHashMap

/**
 * Real torrent engine for the phone, behind the same HTTP surface as the
 * desktop sidecar.
 *
 *  - one SessionManager for the whole app, kept for the process lifetime
 *  - only the requested file is selected (Priority.DEFAULT, everything else
 *    IGNORE) and reading starts at the requested piece, so a film does not pull
 *    the whole torrent before the first byte
 *  - a Range request waits for the covering piece and streams from the file
 *    libtorrent writes, so memory stays flat
 *  - any failure leaves [ready] false and the web app falls back to the server
 */
class LibtorrentEngine(
    private val context: Context,
    private val saveDir: File,
) : TorrentEngine {

    private val session = SessionManager()
    private val handles = ConcurrentHashMap<String, TorrentHandle>()
    private var started = false

    override val name: String = "libtorrent4j"
    override val ready: Boolean get() = started

    fun start(): Boolean {
        if (started) return true
        return try {
            saveDir.mkdirs()
            session.start(SessionParams())
            started = true
            true
        } catch (e: Throwable) {
            started = false
            false
        }
    }

    override fun torrentCount(): Int = handles.size

    override fun stopAll() {
        for (handle in handles.values) {
            try {
                session.remove(handle)
            } catch (_: Throwable) {
            }
        }
        handles.clear()
        try {
            saveDir.deleteRecursively()
            saveDir.mkdirs()
        } catch (_: Throwable) {
        }
    }

    /** Adds the magnet once and returns the handle, or null when it cannot. */
    private fun handleFor(magnet: String): TorrentHandle? {
        handles[magnet]?.let { if (it.isValid) return it else handles.remove(magnet) }

        val hex = HEX_HASH.find(magnet)?.groupValues?.get(1) ?: return null
        val hash = try {
            Sha1Hash.parseHex(hex)
        } catch (_: Throwable) {
            return null
        }

        session.find(hash)?.let {
            handles[magnet] = it
            return it
        }

        try {
            session.download(magnet, saveDir, torrent_flags_t())
        } catch (_: Throwable) {
            return null
        }

        val deadline = System.currentTimeMillis() + ADD_TIMEOUT_MS
        while (System.currentTimeMillis() < deadline) {
            val handle = session.find(hash)
            if (handle != null) {
                handles[magnet] = handle
                return handle
            }
            Thread.sleep(150)
        }
        return null
    }

    private fun awaitInfo(handle: TorrentHandle, timeoutMs: Long): TorrentInfo? {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val info = try {
                handle.torrentFile()
            } catch (_: Throwable) {
                null
            }
            if (info != null) return info
            if (!handle.isValid) return null
            Thread.sleep(200)
        }
        return null
    }

    private fun pickFile(info: TorrentInfo, requested: Int?): Int {
        val files = info.files()
        if (requested != null && requested in 0 until files.numFiles()) return requested

        var best = 0
        var bestSize = 0L
        for (i in 0 until files.numFiles()) {
            val path = files.filePath(i).lowercase()
            val isVideo = VIDEO_EXT.any { path.endsWith(it) }
            val size = files.fileSize(i)
            if (isVideo && size > bestSize) {
                best = i
                bestSize = size
            }
        }
        return best
    }

    private fun selectOnly(handle: TorrentHandle, info: TorrentInfo, index: Int) {
        val priorities = Array(info.files().numFiles()) { i ->
            if (i == index) Priority.DEFAULT else Priority.IGNORE
        }
        try {
            handle.prioritizeFiles(priorities)
        } catch (_: Throwable) {
        }
    }

    private fun pieceFor(info: TorrentInfo, fileIndex: Int, offset: Long): Int {
        val absolute = info.files().fileOffset(fileIndex) + offset
        return (absolute / info.pieceLength()).toInt()
    }

    private fun waitForPiece(handle: TorrentHandle, piece: Int, timeoutMs: Long): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val have = try {
                handle.havePiece(piece)
            } catch (_: Throwable) {
                false
            }
            if (have) return true
            if (!handle.isValid) return false
            Thread.sleep(100)
        }
        return false
    }

    override fun serve(magnet: String, fileIndex: Int?, range: String?, out: OutputStream) {
        val handle = handleFor(magnet) ?: return httpError(out, 502, "could not add torrent")
        val info = awaitInfo(handle, METADATA_TIMEOUT_MS)
            ?: return httpError(out, 504, "no seeders answered in time")

        val index = pickFile(info, fileIndex)
        selectOnly(handle, info, index)

        val size = info.files().fileSize(index)
        if (size <= 0) return httpError(out, 404, "empty file")

        val bounds = parseRange(range, size)
        if (bounds == null) {
            out.write("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */$size\r\nConnection: close\r\n\r\n".toByteArray())
            out.flush()
            return
        }
        val (start, end) = bounds

        // Start the sequential window at the first piece the client asks for.
        try {
            handle.setSequentialRange(pieceFor(info, index, start))
        } catch (_: Throwable) {
        }

        val path = File(saveDir, info.files().filePath(index))
        val length = end - start + 1

        out.write(
            buildString {
                append("HTTP/1.1 206 Partial Content\r\n")
                append("Content-Type: video/mp4\r\n")
                append("Accept-Ranges: bytes\r\n")
                append("Content-Length: $length\r\n")
                append("Content-Range: bytes $start-$end/$size\r\n")
                append("Access-Control-Allow-Origin: https://dipkri.duckdns.org\r\n")
                append("Connection: close\r\n\r\n")
            }.toByteArray(),
        )
        out.flush()

        RandomAccessFile(path, "r").use { file ->
            var position = start
            val buffer = ByteArray(CHUNK)
            while (position <= end) {
                val piece = pieceFor(info, index, position)
                if (!waitForPiece(handle, piece, PIECE_TIMEOUT_MS)) return
                val toRead = minOf(buffer.size.toLong(), end - position + 1).toInt()
                file.seek(position)
                val read = file.read(buffer, 0, toRead)
                if (read <= 0) return
                out.write(buffer, 0, read)
                out.flush()
                position += read
            }
        }
    }

    private fun parseRange(header: String?, size: Long): Pair<Long, Long>? {
        if (header.isNullOrBlank()) return 0L to size - 1
        val match = RANGE.find(header) ?: return null
        val rawStart = match.groupValues[1]
        val rawEnd = match.groupValues[2]

        if (rawStart.isEmpty()) {
            val suffix = rawEnd.toLongOrNull() ?: return null
            if (suffix <= 0) return null
            return maxOf(0, size - suffix) to size - 1
        }

        val start = rawStart.toLongOrNull() ?: return null
        val end = if (rawEnd.isEmpty()) size - 1 else minOf(rawEnd.toLongOrNull() ?: size - 1, size - 1)
        if (start < 0 || start >= size || end < start) return null
        return start to end
    }

    private fun httpError(out: OutputStream, status: Int, message: String) {
        val body = """{"error":"$message"}""".toByteArray()
        out.write(
            ("HTTP/1.1 $status Error\r\nContent-Type: application/json\r\n" +
                "Content-Length: ${body.size}\r\nConnection: close\r\n\r\n").toByteArray(),
        )
        out.write(body)
        out.flush()
    }

    companion object {
        private val HEX_HASH = Regex("urn:btih:([a-fA-F0-9]{40})")
        private val RANGE = Regex("bytes=(\\d*)-(\\d*)")
        private val VIDEO_EXT = listOf(".mp4", ".mkv", ".webm", ".avi", ".m4v", ".mov")

        private const val ADD_TIMEOUT_MS = 30_000L
        private const val METADATA_TIMEOUT_MS = 45_000L
        private const val PIECE_TIMEOUT_MS = 45_000L
        private const val CHUNK = 256 * 1024
    }
}
