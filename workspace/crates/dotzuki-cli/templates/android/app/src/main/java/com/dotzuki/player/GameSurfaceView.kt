package com.dotzuki.player

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.view.Choreographer
import android.view.SurfaceHolder
import android.view.SurfaceView
import kotlin.math.ceil
import kotlin.math.floor

class GameSurfaceView(context: Context) : SurfaceView(context), SurfaceHolder.Callback,
    Choreographer.FrameCallback {
    var inputBits: Int = 0
    private var active = false
    private var surfaceReady = false
    private var lastFrameNanos = 0L
    private var accumulator = 0.0
    private val frameWidth = NativeBridge.width()
    private val frameHeight = NativeBridge.height()
    private val bounds = IntArray(4)
    private var refresh = true
    private val bitmap = Bitmap.createBitmap(frameWidth, frameHeight, Bitmap.Config.ARGB_8888)
    private val paint = Paint().apply { isFilterBitmap = false }

    init {
        holder.addCallback(this)
    }

    fun resumeFrames() {
        if (active) return
        active = true
        refresh = true
        lastFrameNanos = 0L
        Choreographer.getInstance().postFrameCallback(this)
    }

    fun pauseFrames() {
        active = false
        NativeBridge.cancelPointer()
        inputBits = 0
        Choreographer.getInstance().removeFrameCallback(this)
    }

    override fun doFrame(frameTimeNanos: Long) {
        if (!active) return
        if (lastFrameNanos == 0L) {
            accumulator = STEP_SECONDS
        } else {
            accumulator += ((frameTimeNanos - lastFrameNanos) / 1_000_000_000.0)
                .coerceAtMost(STEP_SECONDS * 4.0)
        }
        lastFrameNanos = frameTimeNanos
        while (accumulator >= STEP_SECONDS) {
            NativeBridge.tick(inputBits)
            accumulator -= STEP_SECONDS
        }
        drawGameFrame()
        Choreographer.getInstance().postFrameCallback(this)
    }

    private fun drawGameFrame() {
        if (!surfaceReady || !NativeBridge.updateBitmap(bitmap, bounds, refresh)) return
        val dest = fitRect(width, height)
        val sx = dest.width() / frameWidth
        val sy = dest.height() / frameHeight
        val dirty = if (refresh) null else Rect(
            floor(dest.left + bounds[0] * sx).toInt(),
            floor(dest.top + bounds[1] * sy).toInt(),
            ceil(dest.left + (bounds[0] + bounds[2]) * sx).toInt(),
            ceil(dest.top + (bounds[1] + bounds[3]) * sy).toInt(),
        )
        // SurfaceHolder can expand the requested damage for a different back buffer.
        refresh = true
        val canvas = holder.lockCanvas(dirty) ?: return
        try {
            canvas.drawColor(Color.BLACK)
            canvas.drawBitmap(bitmap, null, fitRect(canvas), paint)
        } finally {
            holder.unlockCanvasAndPost(canvas)
        }
        refresh = false
    }

    fun clickToMove(x: Float, y: Float) {
        if (!active || !surfaceReady) return
        val rect = fitRect(width, height)
        if (!rect.contains(x, y)) return
        NativeBridge.pointerClick((x - rect.left) * frameWidth / rect.width(),
            (y - rect.top) * frameHeight / rect.height())
    }

    private fun fitRect(canvas: Canvas): RectF = fitRect(canvas.width, canvas.height)

    private fun fitRect(viewWidth: Int, viewHeight: Int): RectF {
        val scale = minOf(viewWidth.toFloat() / frameWidth, viewHeight.toFloat() / frameHeight)
        val width = frameWidth * scale
        val height = frameHeight * scale
        val left = (viewWidth - width) / 2f
        val top = (viewHeight - height) / 2f
        return RectF(left, top, left + width, top + height)
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        refresh = true
        surfaceReady = true
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        refresh = true
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        surfaceReady = false
    }

    private companion object {
        const val STEP_SECONDS = 1.0 / 59.7275
    }
}
