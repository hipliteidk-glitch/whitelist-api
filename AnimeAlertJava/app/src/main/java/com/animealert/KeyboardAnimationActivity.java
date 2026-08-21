package com.animealert;

import android.animation.AnimatorSet;
import android.animation.ObjectAnimator;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.widget.BaseAdapter;
import android.widget.EditText;
import android.widget.GridView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

public class KeyboardAnimationActivity extends AppCompatActivity {

    private GridView keyboardGrid;
    private EditText editText;
    private KeyAdapter adapter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_keyboard_animation);

        editText = findViewById(R.id.editText);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            editText.setShowSoftInputOnFocus(false);
        }
        keyboardGrid = findViewById(R.id.keyboardGrid);
        adapter = new KeyAdapter();
        keyboardGrid.setAdapter(adapter);

        findViewById(R.id.backButton).setOnClickListener(v -> finish());
        findViewById(R.id.enableImeButton).setOnClickListener(v ->
                startActivity(new Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)));
    }

    @Override
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }

    private class KeyAdapter extends BaseAdapter {
        private final String[] keys = {
                "A", "B", "C", "D",
                "E", "F", "G", "H",
                "I", "J", "K", "L",
                "M", "N", "O", "P",
                "Q", "R", "S", "T",
                "U", "V", "W", "X",
                "Y", "Z"
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
            final String key = keys[position];
            keyText.setText(key);

            convertView.setOnClickListener(v -> {
                ObjectAnimator scaleX = ObjectAnimator.ofFloat(v, "scaleX", 1.0f, 1.3f, 1.0f);
                ObjectAnimator scaleY = ObjectAnimator.ofFloat(v, "scaleY", 1.0f, 1.3f, 1.0f);
                ObjectAnimator alpha = ObjectAnimator.ofFloat(v, "alpha", 1.0f, 0.7f, 1.0f);
                AnimatorSet keyAnim = new AnimatorSet();
                keyAnim.playTogether(scaleX, scaleY, alpha);
                keyAnim.setInterpolator(new AccelerateDecelerateInterpolator());
                keyAnim.setDuration(200);
                keyAnim.start();

                String currentText = editText.getText().toString();
                int cursorPos = editText.getSelectionStart();
                if (cursorPos < 0) cursorPos = currentText.length();
                String newText = currentText.substring(0, cursorPos) + key + currentText.substring(cursorPos);
                editText.setText(newText);
                editText.setSelection(cursorPos + 1);

                ObjectAnimator textScaleX = ObjectAnimator.ofFloat(editText, "scaleX", 1.0f, 1.05f, 1.0f);
                ObjectAnimator textScaleY = ObjectAnimator.ofFloat(editText, "scaleY", 1.0f, 1.05f, 1.0f);

                editText.setBackgroundColor(Color.argb(80, 100, 200, 255));
                editText.postDelayed(() -> {
                    editText.setBackgroundResource(R.drawable.edittext_bg);
                }, 300);

                AnimatorSet textAnim = new AnimatorSet();
                textAnim.playTogether(textScaleX, textScaleY);
                textAnim.setInterpolator(new AccelerateDecelerateInterpolator());
                textAnim.setDuration(200);
                textAnim.start();
            });

            return convertView;
        }
    }
}
