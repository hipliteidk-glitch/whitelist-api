package com.animealert;

import android.os.Bundle;
import androidx.appcompat.app.AppCompatActivity;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.concurrent.TimeUnit;

public class MainActivity extends AppCompatActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // Schedule periodic check (every 6 hours)
        PeriodicWorkRequest checkRequest = new PeriodicWorkRequest.Builder(
                AnimeCheckWorker.class,
                6, TimeUnit.HOURS)
                .build();
        WorkManager.getInstance(this).enqueue(checkRequest);
    }
}
