package com.dotzuki.player

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.util.SparseIntArray
import android.util.TypedValue
import android.view.MotionEvent
import android.view.View

class GamepadView(context: Context) : View(context) {
    var onInputChanged: (Int) -> Unit = {}
    private val pointers = SparseIntArray()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textAlign = Paint.Align.CENTER
        textSize = TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_SP,
            16f,
            resources.displayMetrics,
        )
    }
    private val buttons = Array(8) { RectF() }
    private var inputBits = 0

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        layoutButtons(width.toFloat(), height.toFloat())
        val labels = arrayOf("A", "B", "SELECT", "START", "→", "←", "↑", "↓")
        for (bit in buttons.indices) {
            paint.color = if ((inputBits and (1 shl bit)) != 0) PRESSED else IDLE
            canvas.drawRoundRect(buttons[bit], 18f, 18f, paint)
            val rect = buttons[bit]
            canvas.drawText(labels[bit], rect.centerX(), rect.centerY() - (label.ascent() + label.descent()) / 2, label)
        }
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                val index = event.actionIndex
                pointers.put(event.getPointerId(index), buttonAt(event.getX(index), event.getY(index)))
            }
            MotionEvent.ACTION_MOVE -> {
                pointers.clear()
                for (index in 0 until event.pointerCount) {
                    pointers.put(event.getPointerId(index), buttonAt(event.getX(index), event.getY(index)))
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> {
                pointers.delete(event.getPointerId(event.actionIndex))
                if (event.actionMasked == MotionEvent.ACTION_UP) performClick()
            }
            MotionEvent.ACTION_CANCEL -> pointers.clear()
        }
        var next = 0
        for (index in 0 until pointers.size()) {
            val bit = pointers.valueAt(index)
            if (bit >= 0) next = next or (1 shl bit)
        }
        if (next != inputBits) {
            inputBits = next
            onInputChanged(next)
            invalidate()
        }
        return true
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }

    private fun buttonAt(x: Float, y: Float): Int {
        for (bit in buttons.indices) if (buttons[bit].contains(x, y)) return bit
        return -1
    }

    private fun layoutButtons(w: Float, h: Float) {
        val unit = minOf(w / 8f, h / 3.4f)
        val dpadX = w * 0.24f
        val dpadY = h * 0.45f
        buttons[6].set(dpadX - unit * .45f, dpadY - unit * 1.45f, dpadX + unit * .45f, dpadY - unit * .45f)
        buttons[7].set(dpadX - unit * .45f, dpadY + unit * .45f, dpadX + unit * .45f, dpadY + unit * 1.45f)
        buttons[5].set(dpadX - unit * 1.45f, dpadY - unit * .45f, dpadX - unit * .45f, dpadY + unit * .45f)
        buttons[4].set(dpadX + unit * .45f, dpadY - unit * .45f, dpadX + unit * 1.45f, dpadY + unit * .45f)
        val actionY = dpadY
        buttons[1].set(w * .65f - unit, actionY - unit * .5f, w * .65f, actionY + unit * .5f)
        buttons[0].set(w * .82f - unit * .5f, actionY - unit, w * .82f + unit * .5f, actionY)
        val metaY = h - unit * .7f
        buttons[2].set(w * .34f, metaY - unit * .35f, w * .49f, metaY + unit * .35f)
        buttons[3].set(w * .53f, metaY - unit * .35f, w * .68f, metaY + unit * .35f)
    }

    private companion object {
        val IDLE = Color.rgb(51, 58, 77)
        val PRESSED = Color.rgb(232, 93, 117)
    }
}
