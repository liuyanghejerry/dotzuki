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
    external fun copyFrame(output: ByteBuffer): Int
    external fun audioFill(output: FloatArray, frames: Int): Int
    external fun exportSave(): ByteArray?
    external fun lastError(): String
}
