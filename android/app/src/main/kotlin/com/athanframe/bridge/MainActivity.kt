package com.athanframe.bridge

import android.graphics.Bitmap
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter

/**
 * Tiny on-device UI that shows the bridge's LAN URL + a QR code the user
 * can scan from their phone. Starts the BridgeService on launch.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var statusText: TextView
    private lateinit var urlText: TextView
    private lateinit var qrImage: ImageView
    private lateinit var btnStart: Button
    private lateinit var btnStop: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusText = findViewById(R.id.status)
        urlText    = findViewById(R.id.url)
        qrImage    = findViewById(R.id.qr)
        btnStart   = findViewById(R.id.btnStart)
        btnStop    = findViewById(R.id.btnStop)

        btnStart.setOnClickListener {
            BridgeService.start(this)
            refresh()
        }
        btnStop.setOnClickListener {
            BridgeService.stop(this)
            refresh()
        }

        // Auto-start the service on first launch — that's the whole point.
        BridgeService.start(this)
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun refresh() {
        val ip = NetUtils.firstNonLoopbackIPv4(this) ?: "localhost"
        val url = "http://$ip:${BridgeService.PORT}"
        urlText.text = url
        qrImage.setImageBitmap(qrBitmap(url, 600))

        val pkgMissing = !IntentDispatcher(this).isMasjidalInstalled()
        statusText.text = when {
            pkgMissing -> getString(R.string.status_no_masjidal)
            else       -> getString(R.string.status_running)
        }
        statusText.visibility = View.VISIBLE
    }

    private fun qrBitmap(text: String, size: Int): Bitmap {
        return try {
            val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size)
            val w = matrix.width
            val h = matrix.height
            val pixels = IntArray(w * h)
            for (y in 0 until h) for (x in 0 until w) {
                pixels[y * w + x] = if (matrix.get(x, y)) Color.BLACK else Color.WHITE
            }
            Bitmap.createBitmap(pixels, w, h, Bitmap.Config.ARGB_8888)
        } catch (t: Throwable) {
            Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        }
    }
}
