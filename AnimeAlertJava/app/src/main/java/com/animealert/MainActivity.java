package com.animealert;

import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

public class MainActivity extends AppCompatActivity {
    private TextView statusText, lastCheckText;
    private RecyclerView animeList;
    private AnimeAdapter adapter;
    private List<String> animeNames = new ArrayList<>();
    private Button checkNowButton, addAnimeButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        statusText = findViewById(R.id.statusText);
        lastCheckText = findViewById(R.id.lastCheckText);
        animeList = findViewById(R.id.animeList);
        checkNowButton = findViewById(R.id.checkNowButton);
        addAnimeButton = findViewById(R.id.addAnimeButton);

        // Load saved anime list (simplified – you can use SharedPreferences)
        animeNames.add("One Piece");
        animeNames.add("Demon Slayer");
        animeNames.add("Attack on Titan");

        adapter = new AnimeAdapter(animeNames);
        animeList.setLayoutManager(new LinearLayoutManager(this));
        animeList.setAdapter(adapter);

        // Set status
        statusText.setText("Status: Running");
        String currentTime = new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date());
        lastCheckText.setText("Last check: " + currentTime);

        // Schedule periodic check (every 6 hours)
        PeriodicWorkRequest checkRequest = new PeriodicWorkRequest.Builder(
                AnimeCheckWorker.class,
                6, TimeUnit.HOURS)
                .build();
        WorkManager.getInstance(this).enqueue(checkRequest);

        // Manual check button
        checkNowButton.setOnClickListener(v -> {
            // Trigger a one-time work request
            androidx.work.OneTimeWorkRequest oneTimeCheck = new androidx.work.OneTimeWorkRequest.Builder(AnimeCheckWorker.class).build();
            WorkManager.getInstance(this).enqueue(oneTimeCheck);
            statusText.setText("Status: Checking...");
            // Update last check time
            String now = new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date());
            lastCheckText.setText("Last check: " + now);
        });

        // Add anime button
        addAnimeButton.setOnClickListener(v -> {
            AlertDialog.Builder builder = new AlertDialog.Builder(this);
            builder.setTitle("Add Anime");
            final android.widget.EditText input = new android.widget.EditText(this);
            builder.setView(input);
            builder.setPositiveButton("Add", (dialog, which) -> {
                String name = input.getText().toString().trim();
                if (!name.isEmpty() && !animeNames.contains(name)) {
                    animeNames.add(name);
                    adapter.notifyDataSetChanged();
                    // Optionally save to SharedPreferences here
                }
            });
            builder.setNegativeButton("Cancel", null);
            builder.show();
        });

        // Remove anime on long click
        adapter.setOnItemLongClickListener(position -> {
            animeNames.remove(position);
            adapter.notifyItemRemoved(position);
        });
    }

    // Simple adapter
    private class AnimeAdapter extends RecyclerView.Adapter<AnimeAdapter.ViewHolder> {
        private List<String> data;
        private OnItemLongClickListener longClickListener;

        public AnimeAdapter(List<String> data) {
            this.data = data;
        }

        @Override
        public ViewHolder onCreateViewHolder(ViewGroup parent, int viewType) {
            TextView tv = new TextView(parent.getContext());
            tv.setPadding(16, 16, 16, 16);
            tv.setTextSize(16);
            return new ViewHolder(tv);
        }

        @Override
        public void onBindViewHolder(ViewHolder holder, int position) {
            holder.textView.setText(data.get(position));
            holder.textView.setOnLongClickListener(v -> {
                if (longClickListener != null) longClickListener.onLongClick(position);
                return true;
            });
        }

        @Override
        public int getItemCount() { return data.size(); }

        public void setOnItemLongClickListener(OnItemLongClickListener listener) {
            this.longClickListener = listener;
        }

        class ViewHolder extends RecyclerView.ViewHolder {
            TextView textView;
            ViewHolder(TextView v) { super(v); textView = v; }
        }
    }

    interface OnItemLongClickListener {
        void onLongClick(int position);
    }
}
