package com.athanframe.bridge

import android.content.Context
import android.net.wifi.WifiManager
import java.net.NetworkInterface

/** Network helpers — figure out which LAN IP the phone should hit. */
object NetUtils {

    /**
     * Best-effort: the first non-loopback IPv4 address bound to any
     * interface. On a typical home Wi-Fi this is the device's DHCP-assigned
     * 192.168.x.y or 10.0.x.y address.
     */
    fun firstNonLoopbackIPv4(context: Context): String? {
        // Try the WifiManager first; it's the most direct on a Wi-Fi-only
        // device like the frame.
        try {
            val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val ipInt = wm.connectionInfo.ipAddress
            if (ipInt != 0) {
                val bytes = byteArrayOf(
                    (ipInt and 0xff).toByte(),
                    (ipInt shr 8 and 0xff).toByte(),
                    (ipInt shr 16 and 0xff).toByte(),
                    (ipInt shr 24 and 0xff).toByte()
                )
                val parts = bytes.map { (it.toInt() and 0xff).toString() }
                return parts.joinToString(".")
            }
        } catch (_: Throwable) { }

        // Fallback: walk every network interface.
        try {
            val ifaces = NetworkInterface.getNetworkInterfaces() ?: return null
            for (iface in ifaces) {
                if (iface.isLoopback || !iface.isUp) continue
                for (addr in iface.inetAddresses) {
                    if (!addr.isLoopbackAddress && addr.hostAddress?.contains(':') == false) {
                        return addr.hostAddress
                    }
                }
            }
        } catch (_: Throwable) { }
        return null
    }
}
