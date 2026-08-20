package com.animealert;

import android.animation.AnimatorInflater;
import android.animation.AnimatorSet;
import android.animation.ObjectAnimator;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.widget.BaseAdapter;
import android.widget.GridView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import java.util.ArrayList;
import java.util.List;

public class KeyboardAnimationActivity extends AppCompatActivity {

    private GridView keyboardGrid;
    private KeyAdapter adapter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_keyboard_animation);

        keyboardGrid = findViewById(R.id.keyboardGrid);
        adapter = new KeyAdapter();
        keyboardGrid.setAdapter(adapter);
    }

    private class KeyAdapter extends BaseAdapter {
        private final String[] keys = {
                "A", "B", "C", "D",
                "E", "F", "G", "H",
                "I", "J", "K", "L",
                "M", "N", "O", "P"
        };

        @Override
        public int getCount() {
            return keys.length;
        }

        @Override
        public Object getItem(int position) {
            return keys[position];
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            if (convertView == null) {
                convertView = LayoutInflater.from(parent.getContext())
                        .inflate(R.layout.item_key, parent, false);
            }

            TextView keyText = convertView.findViewById(R.id.keyText);
            keyText.setText(keys[position]);

            // Set click listener for animation
            convertView.setOnClickListener(v -> {
                // Pop animation: scale up then back
                ObjectAnimator scaleX = ObjectAnimator.ofFloat(v, "scaleX", 1.0f, 1.3f, 1.0f);
                ObjectAnimator scaleY = ObjectAnimator.ofFloat(v, "scaleY", 1.0f, 1.3f, 1.0f);
                ObjectAnimator alpha = ObjectAnimator.ofFloat(v, "alpha", 1.0f, 0.7f, 1.0f);

                AnimatorSet set = new AnimatorSet();
                set.playTogether(scaleX, scaleY, alpha);
                set.setInterpolator(new AccelerateDecelerateInterpolator());
                set.setDuration(200);
                set.start();
            });

            return convertView;
        }
    }
}
