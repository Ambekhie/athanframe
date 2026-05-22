package com.athanframe.bridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * Foreground service that hosts the embedded HTTP server.
 *
 * Why a foreground service: regular background services on Android 8+ are
 * killed within minutes. A foreground service with an ongoing notification
 * is the supported pattern for "user-visible background work" such as a
 * local web server.
 */
class BridgeService : Service() {

    private var server: HttpServer? = null
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForegroundWithNotification(initialUrlText())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (server == null) {
            try {
                server = HttpServer(applicationContext, PORT).also { it.start() }
                acquireWakeLock()
                Log.i(TAG, "Bridge HTTP server started on port $PORT")
                // Refresh the notification once we know the real URL.
                updateNotification(currentUrlText())
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to start HTTP server", t)
                stopSelf()
            }
        }
        // STICKY: if the system kills us under memory pressure, restart.
        return START_STICKY
    }

    override fun onDestroy() {
        try {
            server?.stop()
        } catch (_: Throwable) { }
        server = null
        releaseWakeLock()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ----- Notification ------------------------------------------------------

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.notification_channel_desc)
                setShowBadge(false)
            }
            val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(urlText: String): Notification {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pi = PendingIntent.getActivity(this, 0, openIntent, flags)

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_text, urlText))
            .setContentIntent(pi)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun startForegroundWithNotification(urlText: String) {
        startForeground(NOTIF_ID, buildNotification(urlText))
    }

    private fun updateNotification(urlText: String) {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_ID, buildNotification(urlText))
    }

    private fun initialUrlText(): String = "http://…:$PORT"
    private fun currentUrlText(): String {
        val ip = NetUtils.firstNonLoopbackIPv4(applicationContext) ?: "localhost"
        return "http://$ip:$PORT"
    }

    // ----- Wake lock ---------------------------------------------------------

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "athanframe:bridge")
        wakeLock?.setReferenceCounted(false)
        wakeLock?.acquire()
    }

    private fun releaseWakeLock() {
        try {
            if (wakeLock?.isHeld == true) wakeLock?.release()
        } catch (_: Throwable) { }
        wakeLock = null
    }

    companion object {
        private const val TAG = "BridgeService"
        const val PORT = 8080
        private const val CHANNEL_ID = "athanframe.bridge.channel"
        private const val NOTIF_ID = 1001

        fun start(context: Context) {
            val intent = Intent(context, BridgeService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, BridgeService::class.java))
        }
    }
}
