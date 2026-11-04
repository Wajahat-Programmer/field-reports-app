package com.fieldreports

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Holds a foreground notification while reports are waiting to upload, and runs a JavaScript task for as long
 * as it is up. The task does nothing itself; while it is running React Native keeps the app's timers alive in
 * the background, which the upload runner needs for its stall watchdog and its retry delays. The foreground
 * service in turn keeps Android from freezing or killing the process.
 */
class UploadKeepAliveService : HeadlessJsTaskService() {
  private var taskStarted = false

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    // timeout 0: no limit; allowed in the foreground so the task is the same whether the app is visible or not.
    HeadlessJsTaskConfig("UploadKeepAlive", Arguments.createMap(), 0, true)

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    showNotification(intent?.getStringExtra(EXTRA_TEXT) ?: "Reports are waiting to upload")
    if (taskStarted) {
      return START_NOT_STICKY // a text update only: the task is already running
    }
    taskStarted = true
    super.onStartCommand(intent, flags, startId)
    // If the process is killed there is nothing to restore here; the app resumes uploads when opened.
    return START_NOT_STICKY
  }

  private fun showNotification(text: String) {
    val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Report uploads", NotificationManager.IMPORTANCE_LOW)
      )
    }
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID)
      else @Suppress("DEPRECATION") Notification.Builder(this)
    val notification =
      builder
        .setContentTitle("Field reports")
        .setContentText(text)
        .setSmallIcon(android.R.drawable.stat_sys_upload)
        .setOngoing(true)
        .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  companion object {
    const val EXTRA_TEXT = "text"
    private const val CHANNEL_ID = "uploads"
    private const val NOTIFICATION_ID = 41
  }
}
