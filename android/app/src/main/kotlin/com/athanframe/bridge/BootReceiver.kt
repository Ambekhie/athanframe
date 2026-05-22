package com.athanframe.bridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Restart the bridge service when the device boots. Required because the
 * frame may reboot (firmware OTA, power loss) and we want the bridge to
 * come back up without user intervention.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_LOCKED_BOOT_COMPLETED) {
            Log.i(TAG, "boot completed; starting bridge service")
            BridgeService.start(context)
        }
    }
    companion object { private const val TAG = "BootReceiver" }
}
