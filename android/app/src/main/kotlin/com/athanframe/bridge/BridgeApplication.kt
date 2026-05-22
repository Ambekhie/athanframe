package com.athanframe.bridge

import android.app.Application

/**
 * Process-wide singleton holder. Currently empty but exists to give the
 * service and HTTP server a stable place to hang shared state in the future
 * (e.g. cached reciter catalog, last-known-playing track).
 */
class BridgeApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    companion object {
        lateinit var instance: BridgeApplication
            private set
    }
}
