package com.animealert;

import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.widget.Toast;

public class MainActivity extends AppCompatActivity {
    private static final String CHANNEL_ID = "anime_alerts";
    private static final String CHANNEL_NAME = "Anime Alerts";
    private static final int OVERLAY_PERMISSION_REQUEST = 1001;
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Create notification channel (for Android 8+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }

        // Start the floating overlay service
        startFloatingService();

        // Request overlay permission if needed
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getPackageName()));
            startActivityForResult(intent, OVERLAY_PERMISSION_REQUEST);
        }

        webView = new WebView(this);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());

        // Add JavaScript interface for notifications
        webView.addJavascriptInterface(new WebAppInterface(), "Android");

        // Load the new AniNotify HTML from assets
        webView.loadUrl("file:///android_asset/index.html");

        setContentView(webView);
    }

    private void startFloatingService() {
        Intent serviceIntent = new Intent(this, FloatingAlertService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        // Stop the floating service when app is closed
        Intent serviceIntent = new Intent(this, FloatingAlertService.class);
        stopService(serviceIntent);
    }

    // Clear the counter when app is opened (user has seen notifications)
    @Override
    protected void onResume() {
        super.onResume();
        SharedPreferences prefs = getSharedPreferences("anime_alert", MODE_PRIVATE);
        int count = prefs.getInt("new_episodes_count", 0);
        if (count > 0) {
            // Reset counter after opening app (user has seen new episodes)
            prefs.edit().putInt("new_episodes_count", 0).apply();
            // The service will pick up the change on its next update
        }
    }

    private class WebAppInterface {
        @JavascriptInterface
        public void showNotification(String message) {
            // Store the latest episode message for overlay preview
            SharedPreferences prefs = getSharedPreferences("anime_alert", MODE_PRIVATE);
            prefs.edit().putString("latest_episode", message).apply();

            NotificationCompat.Builder builder = new NotificationCompat.Builder(MainActivity.this, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle("Anime Alert")
                    .setContentText(message)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setAutoCancel(true);

            NotificationManagerCompat manager = NotificationManagerCompat.from(MainActivity.this);
            manager.notify((int) System.currentTimeMillis(), builder.build());

            // Increment overlay count when a new episode is found
            int currentCount = prefs.getInt("new_episodes_count", 0);
            prefs.edit().putInt("new_episodes_count", currentCount + 1).apply();
        }
    }
}
