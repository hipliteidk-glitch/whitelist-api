package com.animealert;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.app.NotificationCompat;

public class FloatingAlertService extends Service {
    private static final String CHANNEL_ID = "floating_overlay_channel";
    private static final int NOTIFICATION_ID = 1001;
    private WindowManager windowManager;
    private View floatingView;
    private TextView titleText;
    private TextView countText;
    private int count = 0;
    private Handler handler = new Handler(Looper.getMainLooper());
    private Runnable updateRunnable;
    private long countdownTarget = 0;
    private String countdownTitle = "";
    private int countdownAnimeId = -1;
    private boolean isCountdownMode = false;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, createNotification());
        createFloatingView();
        loadCountdown();
        updateRunnable = new Runnable() {
            @Override
            public void run() {
                updateDisplay();
                handler.postDelayed(this, 1000);
            }
        };
        handler.post(updateRunnable);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Floating Overlay", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shows anime alert overlay");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification createNotification() {
        Intent intent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Anime Alert Overlay")
                .setContentText("Tap to open app")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(pendingIntent)
                .build();
    }

    private void createFloatingView() {
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        LayoutInflater inflater = (LayoutInflater) getSystemService(LAYOUT_INFLATER_SERVICE);
        floatingView = inflater.inflate(R.layout.floating_bubble, null);
        titleText = floatingView.findViewById(R.id.bubble_title);
        countText = floatingView.findViewById(R.id.bubble_count);

        int layoutFlag;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            layoutFlag = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        } else {
            layoutFlag = WindowManager.LayoutParams.TYPE_PHONE;
        }

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                layoutFlag,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = 50;
        params.y = 100;

        floatingView.setOnTouchListener(new View.OnTouchListener() {
            private int initialX, initialY;
            private float initialTouchX, initialTouchY;
            private long lastTapTime = 0;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        initialX = params.x;
                        initialY = params.y;
                        initialTouchX = event.getRawX();
                        initialTouchY = event.getRawY();
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        params.x = initialX + (int) (event.getRawX() - initialTouchX);
                        params.y = initialY + (int) (event.getRawY() - initialTouchY);
                        windowManager.updateViewLayout(floatingView, params);
                        return true;
                    case MotionEvent.ACTION_UP:
                        float dx = event.getRawX() - initialTouchX;
                        float dy = event.getRawY() - initialTouchY;
                        long now = System.currentTimeMillis();
                        if (Math.abs(dx) < 15 && Math.abs(dy) < 15) {
                            if (now - lastTapTime < 400) {
                                // Double tap: clear countdown and switch to counter mode
                                SharedPreferences prefs = getSharedPreferences("anime_alert", MODE_PRIVATE);
                                prefs.edit().putLong("countdown_target", 0).apply();
                                loadCountdown();
                                updateDisplay();
                                Toast.makeText(FloatingAlertService.this, "Countdown cleared", Toast.LENGTH_SHORT).show();
                                lastTapTime = 0;
                            } else {
                                lastTapTime = now;
                                // Single tap: show preview and open app
                                SharedPreferences prefs = getSharedPreferences("anime_alert", MODE_PRIVATE);
                                String latest = prefs.getString("latest_episode", null);
                                if (latest != null && !latest.isEmpty()) {
                                    Toast.makeText(FloatingAlertService.this, latest, Toast.LENGTH_LONG).show();
                                }
                                // Open MainActivity with the anime ID if in countdown mode
                                Intent intent = new Intent(FloatingAlertService.this, MainActivity.class);
                                if (isCountdownMode && countdownAnimeId > 0) {
                                    intent.putExtra("anime_id", countdownAnimeId);
                                }
                                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                startActivity(intent);
                            }
                        }
                        return true;
                }
                return false;
            }
        });

        windowManager.addView(floatingView, params);
        updateDisplay();
    }

    private void loadCountdown() {
        SharedPreferences prefs = getSharedPreferences("anime_alert", MODE_PRIVATE);
        countdownTarget = prefs.getLong("countdown_target", 0);
        countdownTitle = prefs.getString("countdown_title", "");
        countdownAnimeId = prefs.getInt("countdown_anime_id", -1);
        isCountdownMode = countdownTarget > System.currentTimeMillis();
        if (!isCountdownMode && countdownTarget > 0) {
            prefs.edit().putLong("countdown_target", 0).apply();
            countdownTarget = 0;
        }
    }

    private String formatCountdown(long millis) {
        if (millis <= 0) return "0s";
        long seconds = millis / 1000;
        long minutes = seconds / 60;
        long hours = minutes / 60;
        long days = hours / 24;
        if (days > 0) {
            return days + "d " + (hours % 24) + "h";
        } else if (hours > 0) {
            return hours + "h " + (minutes % 60) + "m";
        } else if (minutes > 0) {
            return minutes + "m " + (seconds % 60) + "s";
        } else {
            return seconds + "s";
        }
    }

    private String truncateTitle(String title, int maxLen) {
        if (title == null) return "";
        if (title.length() <= maxLen) return title;
        return title.substring(0, maxLen) + "…";
    }

    private void updateDisplay() {
        loadCountdown();
        SharedPreferences prefs = getSharedPreferences("anime_alert", MODE_PRIVATE);

        if (isCountdownMode && countdownTarget > System.currentTimeMillis()) {
            long remaining = countdownTarget - System.currentTimeMillis();
            String timeStr = formatCountdown(remaining);
            String displayTitle = countdownTitle.isEmpty() ? "Next" : truncateTitle(countdownTitle, 12);
            titleText.setText(displayTitle);
            countText.setText(timeStr);
            floatingView.setVisibility(View.VISIBLE);
        } else {
            // Fallback to counter mode
            int newCount = prefs.getInt("new_episodes_count", 0);
            if (newCount != count) {
                count = newCount;
            }
            if (count == 0) {
                titleText.setText("");
                countText.setText("");
                floatingView.setVisibility(View.GONE);
            } else {
                titleText.setText("New");
                countText.setText(String.valueOf(count));
                floatingView.setVisibility(View.VISIBLE);
            }
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (floatingView != null) {
            windowManager.removeView(floatingView);
        }
        handler.removeCallbacks(updateRunnable);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
