package com.athanframe.bridge

import android.content.Context
import android.util.Log
import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

/**
 * Embedded HTTP server. Mirrors the routes of the Python pwa-bridge so the
 * same PWA assets (bundled in /assets) work unchanged.
 *
 * Endpoints:
 *   GET  /                    -> bundled PWA index
 *   GET  /static/<file>       -> bundled PWA static file
 *   GET  /icon-<size>.png     -> bundled icon
 *   GET  /manifest.json       -> bundled PWA manifest
 *   GET  /api/config          -> {frame_ip, has_frame, ...}
 *   GET  /api/reciters        -> {reciters: [...]} (served from bundled cache)
 *   GET  /api/surahs          -> {surahs: [{index, name}, ...]}
 *   GET  /api/status          -> {connected, frame, ...}
 *   POST /api/play            -> {reciter, surah}
 *   POST /api/pause           -> ()
 *   POST /api/next            -> ()
 *   POST /api/prev            -> ()
 *   POST /api/stop            -> ()
 *   POST /api/volume          -> {direction, steps}
 *   POST /api/home            -> ()
 */
class HttpServer(
    private val context: Context,
    port: Int
) : NanoHTTPD(port) {

    private val dispatcher = IntentDispatcher(context)

    override fun serve(session: IHTTPSession): Response {
        val uri = session.uri.trimEnd('/')
        val method = session.method
        return try {
            when {
                uri.isEmpty() || uri == "" -> serveAsset("index.html", "text/html")
                uri == "/manifest.json"    -> serveAsset("manifest.json", "application/manifest+json")
                uri.startsWith("/icon-") && uri.endsWith(".png") ->
                    serveAsset(uri.trimStart('/'), "image/png")
                uri.startsWith("/static/") -> {
                    val name = uri.removePrefix("/static/")
                    serveAsset(name, guessMime(name))
                }
                uri.startsWith("/api/")    -> handleApi(uri, method, session)
                else                       -> notFound("no route for $uri")
            }
        } catch (t: Throwable) {
            Log.e(TAG, "request failed: $method $uri", t)
            jsonResponse(Response.Status.INTERNAL_ERROR,
                JSONObject().put("error", t.message ?: "internal error"))
        }
    }

    // ----- API handlers ------------------------------------------------------

    private fun handleApi(uri: String, method: Method, session: IHTTPSession): Response {
        return when (uri) {
            "/api/config"    -> handleConfig()
            "/api/discover"  -> requirePost(method) { handleDiscover() }
            "/api/reciters"  -> handleReciters()
            "/api/surahs"    -> handleSurahs()
            "/api/status"    -> handleStatus()
            "/api/play"      -> requirePost(method) { handlePlay(session) }
            "/api/pause"     -> requirePost(method) { dispatchTap(IntentDispatcher.Tap.PLAY_PAUSE) }
            "/api/next"      -> requirePost(method) { dispatchTap(IntentDispatcher.Tap.NEXT) }
            "/api/prev"      -> requirePost(method) { dispatchTap(IntentDispatcher.Tap.PREV) }
            "/api/stop"      -> requirePost(method) { handleStop() }
            "/api/volume"    -> requirePost(method) { handleVolume(session) }
            "/api/home"      -> requirePost(method) { dispatchTap(IntentDispatcher.Tap.CLOSE) }
            else             -> notFound("no api route $uri")
        }
    }

    private fun requirePost(method: Method, block: () -> Response): Response {
        if (method != Method.POST) {
            return jsonResponse(
                Response.Status.METHOD_NOT_ALLOWED,
                JSONObject().put("error", "POST required")
            )
        }
        return block()
    }

    private fun handleConfig(): Response {
        val ip = NetUtils.firstNonLoopbackIPv4(context)
        val masjidalInstalled = dispatcher.isMasjidalInstalled()
        val obj = JSONObject()
            .put("frame_ip", ip)
            .put("frame", "${ip ?: "127.0.0.1"}:on-device")
            .put("has_frame", masjidalInstalled)
            .put("on_device", true)
            .put("discovery_running", false)
            .put("last_scanned", 0)
        return jsonResponse(Response.Status.OK, obj)
    }

    /**
     * On-device discovery is a no-op: we ARE the device. Return a successful
     * response with our own IP so the PWA's setup flow completes cleanly.
     */
    private fun handleDiscover(): Response {
        val ip = NetUtils.firstNonLoopbackIPv4(context) ?: "127.0.0.1"
        return jsonResponse(
            Response.Status.OK,
            JSONObject()
                .put("ok", true)
                .put("frame_ip", ip)
                .put("log", JSONArray().put("running on-device; no scan needed"))
        )
    }

    private fun handleReciters(): Response {
        // Reciter catalog ships as a static asset. The PWA uses this to
        // populate the picker. We don't fetch from S3 at runtime in v1 to
        // keep the on-device app fully offline-capable.
        val body = readAsset("reciters.json") ?: "{\"reciters\":[]}"
        return newFixedLengthResponse(Response.Status.OK, "application/json", body)
    }

    private fun handleSurahs(): Response {
        val arr = JSONArray()
        SurahData.NAMES.forEachIndexed { i, name ->
            arr.put(JSONObject().put("index", i + 1).put("name", name))
        }
        return jsonResponse(Response.Status.OK, JSONObject().put("surahs", arr))
    }

    private fun handleStatus(): Response {
        val installed = dispatcher.isMasjidalInstalled()
        val obj = JSONObject()
            .put("connected", installed)
            .put("frame", "on-device")
            .put("focus", "")
            .put("on_device", true)
        if (!installed) obj.put("error", "Masjidal app not installed on this device")
        return jsonResponse(Response.Status.OK, obj)
    }

    private fun handlePlay(session: IHTTPSession): Response {
        val body = parseJsonBody(session) ?: return badRequest("invalid JSON body")
        val reciter = body.optString("reciter").takeIf { it.isNotBlank() }
            ?: return badRequest("reciter required")
        val surah = body.optString("surah").takeIf { it.isNotBlank() }
            ?: return badRequest("surah required")
        if (!SurahData.NAMES.contains(surah)) {
            return badRequest("unknown surah: $surah")
        }
        dispatcher.playQuran(reciter, surah)
        return jsonResponse(
            Response.Status.OK,
            JSONObject().put("ok", true).put(
                "playing",
                JSONObject().put("reciter", reciter).put("surah", surah)
            )
        )
    }

    private fun handleStop(): Response {
        dispatcher.tap(IntentDispatcher.Tap.PLAY_PAUSE)
        Thread.sleep(300)
        dispatcher.tap(IntentDispatcher.Tap.CLOSE)
        return ok()
    }

    private fun handleVolume(session: IHTTPSession): Response {
        val body = parseJsonBody(session) ?: return badRequest("invalid JSON body")
        val direction = body.optString("direction")
        if (direction != "up" && direction != "down") {
            return badRequest("direction must be 'up' or 'down'")
        }
        val steps = body.optInt("steps", 3).coerceIn(1, 20)
        val tap = if (direction == "up") IntentDispatcher.Tap.VOL_UP else IntentDispatcher.Tap.VOL_DOWN
        repeat(steps) {
            dispatcher.tap(tap)
            Thread.sleep(120)
        }
        return jsonResponse(
            Response.Status.OK,
            JSONObject().put("ok", true).put("direction", direction).put("steps", steps)
        )
    }

    private fun dispatchTap(tap: IntentDispatcher.Tap): Response {
        dispatcher.tap(tap)
        return ok()
    }

    // ----- Assets ------------------------------------------------------------

    private fun serveAsset(name: String, mime: String): Response {
        return try {
            val stream = context.assets.open(name)
            val bytes = stream.use { it.readBytes() }
            newFixedLengthResponse(Response.Status.OK, mime, bytes.inputStream(), bytes.size.toLong())
        } catch (e: IOException) {
            notFound("asset not found: $name")
        }
    }

    private fun readAsset(name: String): String? {
        return try {
            context.assets.open(name).use { it.readBytes().toString(Charsets.UTF_8) }
        } catch (e: IOException) {
            null
        }
    }

    // ----- Helpers -----------------------------------------------------------

    private fun parseJsonBody(session: IHTTPSession): JSONObject? {
        return try {
            val files = HashMap<String, String>()
            session.parseBody(files)
            val raw = files["postData"] ?: return null
            JSONObject(raw)
        } catch (t: Throwable) {
            Log.w(TAG, "failed to parse body", t)
            null
        }
    }

    private fun ok(): Response = jsonResponse(Response.Status.OK, JSONObject().put("ok", true))

    private fun badRequest(msg: String): Response =
        jsonResponse(Response.Status.BAD_REQUEST, JSONObject().put("error", msg))

    private fun notFound(msg: String): Response =
        jsonResponse(Response.Status.NOT_FOUND, JSONObject().put("error", msg))

    private fun jsonResponse(status: Response.Status, obj: JSONObject): Response {
        val res = newFixedLengthResponse(status, "application/json", obj.toString())
        // Enable CORS so the PWA hosted at this same origin (or other devices
        // on the LAN that hit the bare IP) can call us without preflight pain.
        res.addHeader("Access-Control-Allow-Origin", "*")
        res.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        res.addHeader("Access-Control-Allow-Headers", "Content-Type")
        return res
    }

    private fun guessMime(name: String): String = when {
        name.endsWith(".html") -> "text/html"
        name.endsWith(".js")   -> "application/javascript"
        name.endsWith(".css")  -> "text/css"
        name.endsWith(".json") -> "application/json"
        name.endsWith(".svg")  -> "image/svg+xml"
        name.endsWith(".png")  -> "image/png"
        name.endsWith(".ico")  -> "image/x-icon"
        else                   -> "application/octet-stream"
    }

    companion object {
        private const val TAG = "HttpServer"
    }
}
