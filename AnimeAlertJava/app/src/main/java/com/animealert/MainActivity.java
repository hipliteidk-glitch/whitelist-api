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

        // Add JavaScript interface for notifications and countdown
        webView.addJavascriptInterface(new WebAppInterface(), "Android");

        // Load the new AniNotify HTML from assets
        webView.loadUrl("file:///android_asset/index.html");

        setContentView(webView);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Clear the counter when app is opened (user has seen notifications)
        SharedPreferences prefs = getSharedPreferences("anime_alert", MODE_PRIVATE);
        int count = prefs.getInt("new_episodes_count", 0);
        if (count > 0) {
            prefs.edit().putInt("new_episodes_count", 0).apply();
        }

        // Check if we were opened from the overlay with a specific anime ID
        Intent intent = getIntent();
        if (intent != null && intent.hasExtra("anime_id")) {
            int animeId = intent.getIntExtra("anime_id", -1);
            if (animeId > 0) {
                // Call JavaScript to open the anime detail
                final int id = animeId;
                webView.post(() -> webView.evaluateJavascript("openAnimeById(" + id + ");", null));
                // Remove the extra so we don't open it again on subsequent resumes
                intent.removeExtra("anime_id");
            }
        }
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

    private class WebAppInterface {
        @JavascriptInterface
        public void showNotification(String message) {
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

            int currentCount = prefs.getInt("new_episodes_count", 0);
            prefs.edit().putInt("new_episodes_count", currentCount + 1).apply();
        }

        @JavascriptInterface
        public void setCountdownTarget(long timestamp, String title, int animeId) {
            SharedPreferences prefs = getSharedPreferences("anime_alert", MODE_PRIVATE);
            prefs.edit().putLong("countdown_target", timestamp)
                 .putString("countdown_title", title)
                 .putInt("countdown_anime_id", animeId)
                 .apply();
        }
    }
}
