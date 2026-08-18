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

import androidx.core.app.NotificationCompat;

public class FloatingAlertService extends Service {
    private static final String CHANNEL_ID = "floating_overlay_channel";
    private static final int NOTIFICATION_ID = 1001;
    private WindowManager windowManager;
    private View floatingView;
    private TextView countText;
    private int count = 0;
    private Handler handler = new Handler(Looper.getMainLooper());
    private Runnable updateRunnable;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, createNotification());
        createFloatingView();
        // Load initial count
        loadCount();
        // Set up periodic update check
        updateRunnable = new Runnable() {
            @Override
            public void run() {
                updateCount();
                handler.postDelayed(this, 5000); // check every 5 seconds
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

        // Drag to move
        floatingView.setOnTouchListener(new View.OnTouchListener() {
            private int initialX, initialY;
            private float initialTouchX, initialTouchY;

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
                        // Check if it's a tap (not a drag)
                        float dx = event.getRawX() - initialTouchX;
                        float dy = event.getRawY() - initialTouchY;
                        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
                            // Open app
                            Intent intent = new Intent(FloatingAlertService.this, MainActivity.class);
                            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(intent);
                        }
                        return true;
                }
                return false;
            }
        });

        windowManager.addView(floatingView, params);
        updateCount();
    }

    private void loadCount() {
        SharedPreferences prefs = getSharedPreferences("anime_alert", MODE_PRIVATE);
        count = prefs.getInt("new_episodes_count", 0);
    }

    private void updateCount() {
        SharedPreferences prefs = getSharedPreferences("anime_alert", MODE_PRIVATE);
        int newCount = prefs.getInt("new_episodes_count", 0);
        if (newCount != count) {
            count = newCount;
            if (countText != null) {
                countText.setText(String.valueOf(count));
                if (count == 0) {
                    countText.setText("");
                    floatingView.setVisibility(View.GONE);
                } else {
                    floatingView.setVisibility(View.VISIBLE);
                }
            }
        }
    }

    public static void updateCount(Context context, int newCount) {
        SharedPreferences prefs = context.getSharedPreferences("anime_alert", MODE_PRIVATE);
        prefs.edit().putInt("new_episodes_count", newCount).apply();
        // The service will pick it up on its periodic update
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
