package com.dotzuki.player

import java.nio.ByteBuffer

object NativeBridge {
    init {
        System.loadLibrary("dotzuki_android")
    }

    external fun abiVersion(): Int
    external fun create(pack: ByteArray, save: ByteArray?): Boolean
    external fun destroy()
    external fun width(): Int
    external fun height(): Int
    external fun frameLength(): Int
    external fun tick(inputBits: Int): Boolean
    external fun pointerClick(x: Float, y: Float): Boolean
    external fun cancelPointer()
    external fun copyFrame(output: ByteBuffer): Int
    external fun audioFill(output: FloatArray, frames: Int): Int
    external fun exportSave(): ByteArray?
    external fun lastError(): String
    external fun touchConfigure(x: Float, y: Float, w: Float, h: Float,
        scale: Float, inset: Float, lift: Float, mirrored: Boolean, floating: Boolean, viewportHeight: Float)
    external fun touchLayout(): FloatArray
    external fun touchEvent(kind: Int, id: Int, x: Float, y: Float): Int
}
