package com.animealert;

import android.animation.AnimatorSet;
import android.animation.ObjectAnimator;
import android.inputmethodservice.InputMethodService;
import android.view.KeyEvent;
import android.view.View;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.widget.TextView;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.EditorInfo;

public class KeyboardService extends InputMethodService {
    private View keyboardView;

    @Override
    public View onCreateInputView() {
        keyboardView = getLayoutInflater().inflate(R.layout.keyboard_layout, null);
        setupKeys();
        return keyboardView;
    }

    private void setupKeys() {
        // QWERTY row
        setKeyListener(R.id.key_Q, 'q');
        setKeyListener(R.id.key_W, 'w');
        setKeyListener(R.id.key_E, 'e');
        setKeyListener(R.id.key_R, 'r');
        setKeyListener(R.id.key_T, 't');
        setKeyListener(R.id.key_Y, 'y');
        setKeyListener(R.id.key_U, 'u');
        setKeyListener(R.id.key_I, 'i');
        setKeyListener(R.id.key_O, 'o');
        setKeyListener(R.id.key_P, 'p');
        // ASDF row
        setKeyListener(R.id.key_A, 'a');
        setKeyListener(R.id.key_S, 's');
        setKeyListener(R.id.key_D, 'd');
        setKeyListener(R.id.key_F, 'f');
        setKeyListener(R.id.key_G, 'g');
        setKeyListener(R.id.key_H, 'h');
        setKeyListener(R.id.key_J, 'j');
        setKeyListener(R.id.key_K, 'k');
        setKeyListener(R.id.key_L, 'l');
        // ZXCV row
        setKeyListener(R.id.key_Z, 'z');
        setKeyListener(R.id.key_X, 'x');
        setKeyListener(R.id.key_C, 'c');
        setKeyListener(R.id.key_V, 'v');
        setKeyListener(R.id.key_B, 'b');
        setKeyListener(R.id.key_N, 'n');
        setKeyListener(R.id.key_M, 'm');
        // Backspace
        keyboardView.findViewById(R.id.key_Backspace).setOnClickListener(v -> {
            animateKey(v);
            InputConnection ic = getCurrentInputConnection();
            if (ic != null) {
                ic.sendKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DEL));
                ic.sendKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DEL));
            }
        });
        // Space
        keyboardView.findViewById(R.id.key_Space).setOnClickListener(v -> {
            animateKey(v);
            InputConnection ic = getCurrentInputConnection();
            if (ic != null) {
                ic.commitText(" ", 1);
            }
        });
    }

    private void setKeyListener(int id, final char character) {
        View key = keyboardView.findViewById(id);
        key.setOnClickListener(v -> {
            animateKey(v);
            InputConnection ic = getCurrentInputConnection();
            if (ic != null) {
                ic.commitText(String.valueOf(character), 1);
            }
        });
    }

    private void animateKey(View v) {
        ObjectAnimator scaleX = ObjectAnimator.ofFloat(v, "scaleX", 1.0f, 1.4f, 1.0f);
        ObjectAnimator scaleY = ObjectAnimator.ofFloat(v, "scaleY", 1.0f, 1.4f, 1.0f);
        ObjectAnimator alpha = ObjectAnimator.ofFloat(v, "alpha", 1.0f, 0.6f, 1.0f);
        AnimatorSet set = new AnimatorSet();
        set.playTogether(scaleX, scaleY, alpha);
        set.setInterpolator(new AccelerateDecelerateInterpolator());
        set.setDuration(150);
        set.start();
    }

    @Override
    public void onStartInputView(EditorInfo info, boolean restarting) {
        super.onStartInputView(info, restarting);
        // Optional: adjust for different input types
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
    }
}