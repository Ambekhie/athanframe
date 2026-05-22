package com.athanframe.bridge

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.util.Log
import java.io.BufferedReader
import java.io.InputStreamReader

/**
 * Talks to the Masjidal app on the same device.
 *
 * Two paths:
 *   - playQuran(): native sendBroadcast() to ScheduleReceiver (rock solid;
 *     same intent the Masjidal scheduler uses internally).
 *   - tap(): falls back to `input tap X Y` via Runtime.exec because the
 *     other controls (pause, next, prev, volume) are bound to in-process
 *     callbacks on a live view object inside Masjidal's process. There's
 *     no public intent surface for them.
 *
 * On a userdebug Athan Frame, `input tap` runs without special permissions
 * because the shell user has UI access. On a locked-down stock device it
 * would not; an AccessibilityService would be required instead.
 */
class IntentDispatcher(private val context: Context) {

    fun isMasjidalInstalled(): Boolean = try {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(MASJIDAL_PKG, 0)
        true
    } catch (_: PackageManager.NameNotFoundException) {
        false
    }

    /**
     * Fire the "play this surah by this reciter" broadcast.
     *
     * Internally, Masjidal's ScheduleReceiver re-broadcasts these extras over
     * LocalBroadcastManager to MasjidDetailView, which invokes
     * showQuranPlayerScreen(...). The result is identical to the user tapping
     * Features -> Qur'an Player -> reciter -> surah on the touchscreen.
     */
    fun playQuran(reciter: String, surah: String) {
        bringMasjidalForeground()
        val intent = Intent().apply {
            component = ComponentName(MASJIDAL_PKG, SCHEDULE_RECEIVER)
            putExtra("type", ALARM_TYPE_QURAN)
            putExtra("typeV", reciter)
            putExtra("typeS", surah)
        }
        try {
            context.sendBroadcast(intent)
            Log.i(TAG, "broadcast play: '$reciter' / '$surah'")
        } catch (t: Throwable) {
            Log.e(TAG, "broadcast play failed", t)
        }
    }

    /**
     * Bring the Masjidal app to the foreground so its in-process broadcast
     * receivers are registered. Equivalent to the `monkey ... LAUNCHER 1`
     * trick we used from ADB in the Python bridge.
     */
    private fun bringMasjidalForeground() {
        val launch = context.packageManager.getLaunchIntentForPackage(MASJIDAL_PKG) ?: return
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        try {
            context.startActivity(launch)
            // Small settle so the activity has time to register its receiver
            // before we fire the broadcast.
            Thread.sleep(400)
        } catch (t: Throwable) {
            Log.w(TAG, "failed to bring Masjidal forward", t)
        }
    }

    /**
     * Coordinates copied from the Python bridge (UI is 1280x800).
     * Re-measure with `adb -s <ip>:5555 exec-out screencap -p` if the
     * Masjidal app's layout changes in a future version.
     */
    enum class Tap(val x: Int, val y: Int) {
        PLUS(52, 705),
        QURAN_TILE(640, 220),
        CLOSE(1224, 33),
        BACK(40, 33),
        PLAY_PAUSE(640, 584),
        PREV(456, 584),
        NEXT(824, 584),
        VOL_UP(1205, 260),
        VOL_DOWN(1205, 520),
    }

    fun tap(t: Tap) {
        runShell("input tap ${t.x} ${t.y}")
    }

    /**
     * Execute a shell command on-device. Works on the frame because it's a
     * userdebug build; on a locked-down stock device the `input` binary
     * still exists but requires the shell uid we don't have. There we'd
     * need an AccessibilityService — a future enhancement.
     */
    private fun runShell(cmd: String): String {
        return try {
            val p = Runtime.getRuntime().exec(arrayOf("sh", "-c", cmd))
            val out = BufferedReader(InputStreamReader(p.inputStream)).use { it.readText() }
            p.waitFor()
            out
        } catch (t: Throwable) {
            Log.w(TAG, "shell '$cmd' failed: ${t.message}")
            ""
        }
    }

    companion object {
        private const val TAG = "IntentDispatcher"
        private const val MASJIDAL_PKG = "com.masjidal.athanframe"
        private const val SCHEDULE_RECEIVER =
            "$MASJIDAL_PKG.schedular.ScheduleReceiver"
        private const val ALARM_TYPE_QURAN = 1
    }
}
