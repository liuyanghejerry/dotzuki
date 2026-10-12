package com.dotzuki.player

import android.app.AlertDialog
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView

/** Transparent controls in window coordinates; the game keeps its own aspect ratio. */
class GamepadView(context: Context) : View(context) {
    var onInputChanged: (Int) -> Unit = {}
    var onSettingsChanged: (Boolean) -> Unit = {}
    private val prefs = context.getSharedPreferences("dotzuki-touch-v1", Context.MODE_PRIVATE)
    private val density get() = resources.displayMetrics.density
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val safe = RectF()
    private var layout = FloatArray(0)
    private var inputBits = 0
    private var dialog: AlertDialog? = null
    private var controlScale = prefs.getFloat("scale", 1f).coerceIn(.85f, 1.2f)
    private var inset = prefs.getFloat("inset", 0f).coerceIn(0f, 48f)
    private var lift = prefs.getFloat("lift", 0f).coerceIn(-48f, 48f)
    private var opacity = prefs.getFloat("opacity", .35f).coerceIn(.2f, .7f)
    private var mirrored = prefs.getBoolean("mirrored", false)
    private var floating = prefs.getBoolean("floating", false)
    private var haptics = prefs.getBoolean("haptics", false)
    private val chinese get() = resources.configuration.locales[0].language == "zh"
    private fun text(en: String, zh: String) = if (chinese) zh else en

    init {
        setBackgroundColor(Color.TRANSPARENT)
        isFocusable = true
        contentDescription = text("Game controls. Tap the gear to customize.", "游戏控制器，点齿轮调整布局")
        setOnApplyWindowInsetsListener { _, insets ->
            val d = density
            if (Build.VERSION.SDK_INT >= 30) {
                val area = insets.getInsets(WindowInsets.Type.systemBars() or
                    WindowInsets.Type.displayCutout() or WindowInsets.Type.systemGestures())
                safe.set(area.left / d, area.top / d, area.right / d, area.bottom / d)
            } else {
                @Suppress("DEPRECATION")
                safe.set(insets.systemWindowInsetLeft / d, insets.systemWindowInsetTop / d,
                    insets.systemWindowInsetRight / d, insets.systemWindowInsetBottom / d)
                if (Build.VERSION.SDK_INT >= 28) insets.displayCutout?.let {
                    safe.left = maxOf(safe.left, it.safeInsetLeft / d)
                    safe.top = maxOf(safe.top, it.safeInsetTop / d)
                    safe.right = maxOf(safe.right, it.safeInsetRight / d)
                    safe.bottom = maxOf(safe.bottom, it.safeInsetBottom / d)
                }
                if (Build.VERSION.SDK_INT >= 29) {
                    val gestures = insets.systemGestureInsets
                    safe.left = maxOf(safe.left, gestures.left / d)
                    safe.right = maxOf(safe.right, gestures.right / d)
                    safe.bottom = maxOf(safe.bottom, gestures.bottom / d)
                }
            }
            configure()
            insets
        }
    }

    private fun configure() {
        if (width == 0 || height == 0) return
        releaseAll()
        NativeBridge.touchConfigure(safe.left, safe.top,
            (width / density - safe.left - safe.right).coerceAtLeast(0f),
            (height / density - safe.top - safe.bottom).coerceAtLeast(0f),
            controlScale, inset, lift, mirrored, floating, height / density)
        layout = NativeBridge.touchLayout()
        invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { configure() }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); requestApplyInsets() }
    override fun onDetachedFromWindow() {
        dialog?.dismiss()
        releaseAll()
        super.onDetachedFromWindow()
    }

    fun releaseAll() {
        NativeBridge.touchEvent(3, 0, 0f, 0f)
        inputBits = 0
        onInputChanged(0)
        layout = NativeBridge.touchLayout()
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.save()
        canvas.scale(density, density)
        for (i in layout.indices step 5) {
            val id = layout[i].toInt()
            val rect = RectF(layout[i + 1], layout[i + 2], layout[i + 1] + layout[i + 3], layout[i + 2] + layout[i + 4])
            if (rect.width() <= 0) continue
            if (id == 8) {
                disc(canvas, rect, inputBits and 0xf0 != 0)
                val r = rect.width() / 2
                val arrows = arrayOf("→", "←", "↑", "↓")
                val dx = floatArrayOf(.62f, -.62f, 0f, 0f)
                val dy = floatArrayOf(0f, 0f, -.62f, .62f)
                for (direction in 0..3) {
                    val pressed = inputBits and (1 shl (direction + 4)) != 0
                    label(canvas, arrows[direction], rect.centerX() + dx[direction] * r,
                        rect.centerY() + dy[direction] * r, 23f, pressed)
                }
                paint.style = Paint.Style.FILL
                paint.color = Color.argb(110, 220, 232, 244)
                canvas.drawCircle(rect.centerX(), rect.centerY(), 4f, paint)
            } else {
                val pressed = id < 8 && inputBits and (1 shl id) != 0
                if (id <= 1) {
                    // Visual circle is smaller than its touch target.
                    rect.inset(4f, 4f)
                    disc(canvas, rect, pressed)
                } else {
                    paint.style = Paint.Style.FILL
                    paint.color = Color.argb((opacity * 255).toInt(), 17, 24, 35)
                    canvas.drawRoundRect(rect, 16f, 16f, paint)
                    outline(canvas, rect, 16f, pressed)
                }
                val title = when (id) { 0 -> "A"; 1 -> "B"; 2 -> "SELECT"; 3 -> "START"; else -> "⚙" }
                label(canvas, title, rect.centerX(), rect.centerY(), if (id in 2..3) 11f else 24f, pressed)
            }
        }
        canvas.restore()
    }

    private fun disc(canvas: Canvas, rect: RectF, pressed: Boolean) {
        paint.style = Paint.Style.FILL
        paint.color = Color.argb((255 * if (pressed) .72f else opacity).toInt(), 17, 24, 35)
        canvas.drawOval(rect, paint)
        outline(canvas, rect, rect.width() / 2, pressed)
    }

    private fun outline(canvas: Canvas, rect: RectF, radius: Float, pressed: Boolean) {
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = if (pressed) 2f else 1.2f
        paint.color = if (pressed) Color.rgb(140, 223, 255) else Color.argb(155, 225, 235, 245)
        canvas.drawRoundRect(rect, radius, radius, paint)
        paint.style = Paint.Style.FILL
    }

    private fun label(canvas: Canvas, value: String, x: Float, y: Float, size: Float, pressed: Boolean) {
        paint.style = Paint.Style.FILL
        paint.textAlign = Paint.Align.CENTER
        paint.textSize = size
        paint.isFakeBoldText = true
        paint.color = if (pressed) Color.rgb(140, 223, 255) else Color.rgb(240, 245, 250)
        canvas.drawText(value, x, y - (paint.ascent() + paint.descent()) / 2, paint)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (dialog != null) return true
        var result = inputBits
        fun send(kind: Int, index: Int) {
            result = NativeBridge.touchEvent(kind, event.getPointerId(index),
                event.getX(index) / density, event.getY(index) / density)
        }
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> send(0, event.actionIndex)
            MotionEvent.ACTION_MOVE -> for (index in 0 until event.pointerCount) send(1, index)
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> send(2, event.actionIndex)
            MotionEvent.ACTION_CANCEL -> { releaseAll(); return true }
        }
        val next = result and 255
        if (haptics && next and inputBits.inv() != 0) performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
        inputBits = next
        onInputChanged(next)
        layout = NativeBridge.touchLayout()
        invalidate()
        if (result and 256 != 0) { performClick(); showSettings() }
        return true
    }

    override fun performClick(): Boolean { super.performClick(); return true }

    private fun saveOptions() {
        prefs.edit().putFloat("scale", controlScale).putFloat("inset", inset)
            .putFloat("lift", lift).putFloat("opacity", opacity).putBoolean("mirrored", mirrored)
            .putBoolean("floating", floating).putBoolean("haptics", haptics).apply()
    }

    private fun showSettings() {
        releaseAll()
        onSettingsChanged(true)
        val panel = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((24 * density).toInt(), 0, (24 * density).toInt(), 0)
        }
        fun slider(title: String, initial: Float, low: Float, high: Float, changed: (Float) -> Unit) {
            val caption = TextView(context)
            fun caption(value: Float) { caption.text = "$title  ${(value * if (high <= 2) 100 else 1).toInt()}${if (high <= 2) "%" else ""}" }
            caption(initial)
            panel.addView(caption)
            panel.addView(SeekBar(context).apply {
                max = 100
                progress = ((initial - low) / (high - low) * 100).toInt()
                layoutParams = LinearLayout.LayoutParams(-1, (48 * density).toInt())
                contentDescription = title
                setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                    override fun onProgressChanged(bar: SeekBar?, progress: Int, fromUser: Boolean) {
                        if (!fromUser) return
                        val value = low + (high - low) * progress / 100f
                        changed(value); caption(value); configure(); saveOptions()
                    }
                    override fun onStartTrackingTouch(bar: SeekBar?) = Unit
                    override fun onStopTrackingTouch(bar: SeekBar?) = Unit
                })
            })
        }
        fun toggle(title: String, value: Boolean, changed: (Boolean) -> Unit) {
            panel.addView(Switch(context).apply {
                text = title; isChecked = value; minimumHeight = (48 * density).toInt()
                setOnCheckedChangeListener { _, checked -> changed(checked); configure(); saveOptions() }
            })
        }
        slider(text("Size", "大小"), controlScale, .85f, 1.2f) { controlScale = it }
        slider(text("Opacity", "不透明度"), opacity, .2f, .7f) { opacity = it }
        slider(text("Move inward", "向内移动"), inset, 0f, 48f) { inset = it }
        slider(text("Vertical offset", "垂直位置"), lift, -48f, 48f) { lift = it }
        toggle(text("Swap sides", "左右交换"), mirrored) { mirrored = it }
        toggle(text("Floating direction pad", "浮动方向盘"), floating) { floating = it }
        toggle(text("Touch feedback", "触觉反馈"), haptics) { haptics = it }
        dialog = AlertDialog.Builder(context).setTitle(text("Touch controls", "触控布局"))
            .setView(ScrollView(context).apply { addView(panel) })
            .setPositiveButton(text("Done", "完成")) { _, _ -> }
            .setNeutralButton(text("Reset", "恢复默认")) { _, _ ->
                controlScale = 1f; inset = 0f; lift = 0f; opacity = .35f
                mirrored = false; floating = false; haptics = false
                saveOptions(); configure()
            }.create().also { alert ->
                alert.setOnDismissListener { dialog = null; releaseAll(); onSettingsChanged(false) }
                alert.show()
            }
    }
}
