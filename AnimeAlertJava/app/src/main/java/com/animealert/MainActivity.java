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
import android.webkit.JavascriptInterface;
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

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.TimeUnit;

public class MainActivity extends AppCompatActivity {
    private static final String CHANNEL_ID = "anime_alerts";
    private static final String CHANNEL_NAME = "Anime Alerts";
    private static final int OVERLAY_PERMISSION_REQUEST = 1001;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1002;
    private WebView webView;
    private static final String UPDATE_URL = "https://raw.githubusercontent.com/hipliteidk-glitch/whitelist-api/main/version.txt";
    private int pendingAnimeId = -1;
    private Handler handler = new Handler(Looper.getMainLooper());
    private int retryCount = 0;

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
        startFloatingService();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getPackageName()));
            startActivityForResult(intent, OVERLAY_PERMISSION_REQUEST);
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
        Intent serviceIntent = new Intent(this, FloatingAlertService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
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
        Intent serviceIntent = new Intent(this, FloatingAlertService.class);
        stopService(serviceIntent);
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
                        new AlertDialog.Builder(MainActivity.this)
                                .setTitle("Update Available")
                                .setMessage("Version " + remoteVersion + " is available. Download now?")
                                .setPositiveButton("Update", (dialog, which) -> downloadUpdate())
                                .setNegativeButton("Later", null)
                                .show();
                    });
                } else if (manual) {
                    runOnUiThread(() -> Toast.makeText(MainActivity.this, "You're on the latest version.", Toast.LENGTH_SHORT).show());
                }
            } catch (Exception e) {
                if (manual) {
                    runOnUiThread(() -> Toast.makeText(MainActivity.this, "Update check failed: " + e.getMessage(), Toast.LENGTH_LONG).show());
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
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Download failed: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }).start();
    }

    private void installUpdate(File apkFile) {
        Uri apkUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", apkFile);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(intent);
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
                startActivity(new Intent(MainActivity.this, KeyboardAnimationActivity.class));
            });
        }
    }
}
