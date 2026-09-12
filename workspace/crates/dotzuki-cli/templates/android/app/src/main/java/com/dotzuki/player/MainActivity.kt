package com.dotzuki.player

import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.LinearLayout
import android.widget.Toast
import java.nio.charset.StandardCharsets

class MainActivity : Activity() {
    private lateinit var gameView: GameSurfaceView
    private val audio = DotzukiAudio()
    private val handler = Handler(Looper.getMainLooper())
    private var runtimeReady = false
    private var lastSave = ""
    private var touchBits = 0
    private var hardwareBits = 0
    private val savePoll = object : Runnable {
        override fun run() {
            persistSave()
            handler.postDelayed(this, SAVE_POLL_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val preferences = getSharedPreferences(SAVE_STORE, MODE_PRIVATE)
        lastSave = preferences.getString(SAVE_KEY, "") ?: ""
        val pack = resources.openRawResource(R.raw.game).use { it.readBytes() }
        val save = lastSave.takeIf { it.isNotEmpty() }?.toByteArray(StandardCharsets.UTF_8)
        if (!NativeBridge.create(pack, save)) {
            Toast.makeText(this, "Game failed to start: ${NativeBridge.lastError()}", Toast.LENGTH_LONG).show()
            finish()
            return
        }
        runtimeReady = true

        gameView = GameSurfaceView(this)
        val gamepad = GamepadView(this).apply {
            onInputChanged = {
                touchBits = it
                updateInput()
            }
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(android.graphics.Color.BLACK)
            addView(gameView, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f,
            ))
            addView(gamepad, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                (260 * resources.displayMetrics.density).toInt(),
            ))
        })
        enterImmersiveMode()
        handler.postDelayed(savePoll, SAVE_POLL_MS)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersiveMode()
    }

    override fun onResume() {
        super.onResume()
        if (!runtimeReady) return
        gameView.resumeFrames()
        audio.start()
    }

    override fun onPause() {
        if (runtimeReady) {
            gameView.pauseFrames()
            touchBits = 0
            hardwareBits = 0
            audio.stop()
            persistSave()
        }
        super.onPause()
    }

    override fun onDestroy() {
        handler.removeCallbacks(savePoll)
        if (runtimeReady) {
            audio.stop()
            persistSave()
            NativeBridge.destroy()
            runtimeReady = false
        }
        super.onDestroy()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        val bit = inputBit(keyCode) ?: return super.onKeyDown(keyCode, event)
        hardwareBits = hardwareBits or (1 shl bit)
        updateInput()
        return true
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        val bit = inputBit(keyCode) ?: return super.onKeyUp(keyCode, event)
        hardwareBits = hardwareBits and (1 shl bit).inv()
        updateInput()
        return true
    }

    private fun updateInput() {
        if (runtimeReady) gameView.inputBits = touchBits or hardwareBits
    }

    private fun enterImmersiveMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            @Suppress("DEPRECATION")
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                )
        }
    }

    private fun persistSave() {
        if (!runtimeReady) return
        val bytes = NativeBridge.exportSave() ?: return
        val save = String(bytes, StandardCharsets.UTF_8)
        if (save.isEmpty() || save == lastSave) return
        getSharedPreferences(SAVE_STORE, MODE_PRIVATE)
            .edit()
            .putString(SAVE_KEY, save)
            .apply()
        lastSave = save
    }

    private companion object {
        const val SAVE_STORE = "dotzuki-game"
        const val SAVE_KEY = "save-v1"
        const val SAVE_POLL_MS = 500L

        fun inputBit(keyCode: Int): Int? = when (keyCode) {
            KeyEvent.KEYCODE_BUTTON_A, KeyEvent.KEYCODE_BUTTON_X, KeyEvent.KEYCODE_ENTER -> 0
            KeyEvent.KEYCODE_BUTTON_B, KeyEvent.KEYCODE_BUTTON_Y, KeyEvent.KEYCODE_ESCAPE -> 1
            KeyEvent.KEYCODE_BUTTON_SELECT -> 2
            KeyEvent.KEYCODE_BUTTON_START -> 3
            KeyEvent.KEYCODE_DPAD_RIGHT -> 4
            KeyEvent.KEYCODE_DPAD_LEFT -> 5
            KeyEvent.KEYCODE_DPAD_UP -> 6
            KeyEvent.KEYCODE_DPAD_DOWN -> 7
            else -> null
        }
    }
}
