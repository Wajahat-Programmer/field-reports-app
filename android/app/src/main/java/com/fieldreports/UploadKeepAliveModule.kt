package com.fieldreports

import android.content.Intent
import androidx.core.content.ContextCompat
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class UploadKeepAliveModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "UploadKeepAlive"

  /** Starts the foreground service, or updates its notification text if it is already running. */
  @ReactMethod
  fun show(text: String) {
    try {
      ContextCompat.startForegroundService(
        context,
        Intent(context, UploadKeepAliveService::class.java).putExtra(UploadKeepAliveService.EXTRA_TEXT, text),
      )
    } catch (e: Exception) {
      // Android refuses to start one from the background. Uploads then just run while the app is open.
    }
  }

  @ReactMethod
  fun stop() {
    context.stopService(Intent(context, UploadKeepAliveService::class.java))
  }
}

class UploadKeepAlivePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(UploadKeepAliveModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
