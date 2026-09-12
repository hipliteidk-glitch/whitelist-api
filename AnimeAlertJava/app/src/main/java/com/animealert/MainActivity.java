package com.animealert;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.AlertDialog;
import android.widget.Toast;
import android.os.Handler;
import android.os.Looper;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.TimeUnit;

public class MainActivity extends AppCompatActivity {
    private static final String TAG = "MainActivity";
    private static final String CHANNEL_ID = "anime_alerts";
    private static final String CHANNEL_NAME = "Anime Alerts";
    private static final int OVERLAY_PERMISSION_REQUEST = 1001;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1002;
    private WebView webView;
    private static final String UPDATE_URL = "https://raw.githubusercontent.com/hipliteidk-glitch/whitelist-api/main/version.txt";
    private int pendingAnimeId = -1;
    private Handler handler = new Handler(Looper.getMainLooper());
    private int retryCount = 0;
    private boolean floatingServiceStarted = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }

        requestNotificationPermission();
        // Only start floating service if overlay permission already granted.
        // Otherwise we will request permission and retry in onResume / onActivityResult.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (Settings.canDrawOverlays(this)) {
                startFloatingService();
            } else {
                Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getPackageName()));
                try {
                    startActivityForResult(intent, OVERLAY_PERMISSION_REQUEST);
                } catch (Exception e) {
                    Log.w(TAG, "Could not launch overlay permission screen", e);
                }
            }
        } else {
            startFloatingService();
        }

        webView = new WebView(this);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (pendingAnimeId > 0) {
                    openAnimeWithRetry(pendingAnimeId);
                }
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new WebAppInterface(), "Android");
        webView.loadUrl("file:///android_asset/index.html");
        setContentView(webView);

        handleAnimeIntent(getIntent());
        scheduleWatchlistChecks();
        checkForUpdate(false);
    }

    private void scheduleWatchlistChecks() {
        Constraints net = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
        PeriodicWorkRequest periodic = new PeriodicWorkRequest.Builder(
                AnimeCheckWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(net)
                .build();
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
                "anime_watchlist_check",
                ExistingPeriodicWorkPolicy.KEEP,
                periodic);
        WorkManager.getInstance(this).enqueue(
                new OneTimeWorkRequest.Builder(AnimeCheckWorker.class)
                        .setConstraints(net)
                        .build());
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        NOTIFICATION_PERMISSION_REQUEST);
            }
        }
    }

    private void openAnimeWithRetry(int id) {
        if (retryCount > 5) {
            Toast.makeText(this, "Could not open anime details. Please try manually.", Toast.LENGTH_SHORT).show();
            pendingAnimeId = -1;
            retryCount = 0;
            return;
        }
        if (webView == null || isFinishing()) {
            pendingAnimeId = -1;
            retryCount = 0;
            return;
        }
        try {
            webView.evaluateJavascript("typeof openAnimeById !== 'undefined' && openAnimeById(" + id + ");", result -> {
                if ("true".equals(result) || "null".equals(result) || result == null) {
                    if (result == null || "null".equals(result) || result.isEmpty()) {
                        retryCount++;
                        handler.postDelayed(() -> openAnimeWithRetry(id), 500);
                    } else {
                        pendingAnimeId = -1;
                        retryCount = 0;
                    }
                } else {
                    pendingAnimeId = -1;
                    retryCount = 0;
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "openAnimeWithRetry failed", e);
            retryCount++;
            handler.postDelayed(() -> openAnimeWithRetry(id), 500);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleAnimeIntent(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        SharedPreferences prefs = getSharedPreferences("anime_alert", MODE_PRIVATE);
        int count = prefs.getInt("new_episodes_count", 0);
        if (count > 0) {
            prefs.edit().putInt("new_episodes_count", 0).apply();
        }
        handleAnimeIntent(getIntent());
        // Retry starting floating service if permission was just granted.
        if (!floatingServiceStarted) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)) {
                startFloatingService();
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == OVERLAY_PERMISSION_REQUEST) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)) {
                startFloatingService();
            } else {
                Log.i(TAG, "Overlay permission not granted after request");
            }
        }
    }

    private void handleAnimeIntent(Intent intent) {
        if (intent != null && intent.hasExtra("anime_id")) {
            int animeId = intent.getIntExtra("anime_id", -1);
            if (animeId > 0) {
                pendingAnimeId = animeId;
                retryCount = 0;
                if (webView != null && webView.getProgress() == 100) {
                    openAnimeWithRetry(animeId);
                }
                intent.removeExtra("anime_id");
            }
        }
    }

    private void startFloatingService() {
        // Guard: only start when overlay permission is granted on M+.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            Log.i(TAG, "startFloatingService skipped: overlay permission not granted");
            return;
        }
        if (floatingServiceStarted) {
            Log.d(TAG, "Floating service already started");
            return;
        }
        try {
            Intent serviceIntent = new Intent(this, FloatingAlertService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
            floatingServiceStarted = true;
            Log.i(TAG, "Floating service started");
        } catch (Exception e) {
            Log.e(TAG, "Failed to start FloatingAlertService", e);
            // Do not crash — user can still use the app without overlay.
            floatingServiceStarted = false;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        try {
            Intent serviceIntent = new Intent(this, FloatingAlertService.class);
            stopService(serviceIntent);
        } catch (Exception e) {
            Log.w(TAG, "stopService failed", e);
        }
        floatingServiceStarted = false;
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
    }

    private void checkForUpdate(boolean manual) {
        new Thread(() -> {
            try {
                URL url = new URL(UPDATE_URL);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                InputStream in = conn.getInputStream();
                byte[] buffer = new byte[1024];
                int len;
                StringBuilder sb = new StringBuilder();
                while ((len = in.read(buffer)) != -1) {
                    sb.append(new String(buffer, 0, len));
                }
                in.close();
                int remoteVersion = Integer.parseInt(sb.toString().trim());
                int currentVersion = getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
                if (remoteVersion > currentVersion) {
                    runOnUiThread(() -> {
                        if (isFinishing()) return;
                        new AlertDialog.Builder(MainActivity.this)
                                .setTitle("Update Available")
                                .setMessage("Version " + remoteVersion + " is available. Download now?")
                                .setPositiveButton("Update", (dialog, which) -> downloadUpdate())
                                .setNegativeButton("Later", null)
                                .show();
                    });
                } else if (manual) {
                    runOnUiThread(() -> {
                        if (isFinishing()) return;
                        Toast.makeText(MainActivity.this, "You're on the latest version.", Toast.LENGTH_SHORT).show();
                    });
                }
            } catch (Exception e) {
                if (manual) {
                    runOnUiThread(() -> {
                        if (isFinishing()) return;
                        Toast.makeText(MainActivity.this, "Update check failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
                    });
                }
            }
        }).start();
    }

    private void downloadUpdate() {
        Toast.makeText(this, "Downloading update...", Toast.LENGTH_LONG).show();
        new Thread(() -> {
            try {
                URL apkUrl = new URL("https://github.com/hipliteidk-glitch/whitelist-api/releases/latest/download/app-release.apk");
                HttpURLConnection conn = (HttpURLConnection) apkUrl.openConnection();
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                File downloadDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (downloadDir == null) downloadDir = getCacheDir();
                File apkFile = new File(downloadDir, "anime-alert-update.apk");
                FileOutputStream fos = new FileOutputStream(apkFile);
                InputStream in = conn.getInputStream();
                byte[] buffer = new byte[4096];
                int len;
                while ((len = in.read(buffer)) != -1) {
                    fos.write(buffer, 0, len);
                }
                fos.close();
                in.close();
                runOnUiThread(() -> installUpdate(apkFile));
            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (isFinishing()) return;
                    Toast.makeText(MainActivity.this, "Download failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        }).start();
    }

    private void installUpdate(File apkFile) {
        try {
            Uri apkUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", apkFile);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(intent);
        } catch (Exception e) {
            Log.e(TAG, "installUpdate failed", e);
            Toast.makeText(this, "Could not open installer: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void safeDeliverCallback(final ValueCallback<String> callback, final String value) {
        runOnUiThread(() -> {
            if (webView == null || isFinishing()) {
                Log.w(TAG, "WebView destroyed before AniList response could be delivered");
                return;
            }
            try {
                callback.onReceiveValue(value);
            } catch (Exception e) {
                Log.w(TAG, "Failed to deliver AniList callback to WebView", e);
            }
        });
    }

    private class WebAppInterface {
        /**
         * Native AniList GraphQL proxy. The file:// WebView cannot fetch
         * https://graphql.anilist.co directly, so the page passes its
         * queries here and receives the raw JSON response (or
         * {\"error\": \"...\"} on failure) through the JS callback.
         */
        @JavascriptInterface
        public void anilistFetch(final String query, final String variablesJson,
                                 final ValueCallback<String> callback) {
            new Thread(() -> {
                final String result;
                try {
                    JsonObject vars = null;
                    if (variablesJson != null && !variablesJson.trim().isEmpty()) {
                        vars = JsonParser.parseString(variablesJson).getAsJsonObject();
                    }
                    result = AniListClient.query(query, vars);
                } catch (final Exception e) {
                    JsonObject err = new JsonObject();
                    err.addProperty("error",
                            e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
                    safeDeliverCallback(callback, err.toString());
                    return;
                }
                safeDeliverCallback(callback, result);
            }).start();
        }

        /** Opens the latest GitHub Release APK in the system browser/downloader. */
        @JavascriptInterface
        public void downloadApk() {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW,
                        Uri.parse("https://github.com/hipliteidk-glitch/whitelist-api/releases/latest/download/app-release.apk"));
                startActivity(intent);
            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (isFinishing()) return;
                    Toast.makeText(MainActivity.this, "Could not open the download page.", Toast.LENGTH_SHORT).show();
                });
            }
        }

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
            try {
                manager.notify((int) System.currentTimeMillis(), builder.build());
            } catch (SecurityException se) {
                Log.w(TAG, "Notification permission missing", se);
            }

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

        @JavascriptInterface
        public void clearCountdown() {
            getSharedPreferences("anime_alert", MODE_PRIVATE)
                    .edit()
                    .putLong("countdown_target", 0)
                    .putString("countdown_title", "")
                    .putInt("countdown_anime_id", -1)
                    .apply();
        }

        @JavascriptInterface
        public void syncWatchlist(String json) {
            getSharedPreferences("anime_alert", MODE_PRIVATE)
                    .edit()
                    .putString("watchlist_json", json == null ? "[]" : json)
                    .apply();
        }

        @JavascriptInterface
        public void checkForUpdate() {
            MainActivity.this.checkForUpdate(true);
        }

        @JavascriptInterface
        public void openKeyboardDemo() {
            runOnUiThread(() -> {
                if (isFinishing()) return;
                startActivity(new Intent(MainActivity.this, KeyboardAnimationActivity.class));
            });
        }
    }
}
