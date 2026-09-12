package com.dotzuki.player

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import java.util.concurrent.atomic.AtomicBoolean

class DotzukiAudio {
    private val active = AtomicBoolean(false)
    private var thread: Thread? = null

    fun start() {
        if (!active.compareAndSet(false, true)) return
        thread = Thread({ runAudio() }, "dotzuki-audio").also { it.start() }
    }

    fun stop() {
        if (!active.compareAndSet(true, false)) return
        thread?.join()
        thread = null
    }

    private fun runAudio() {
        val frames = 512
        val samples = FloatArray(frames * 2)
        val minimum = AudioTrack.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_STEREO,
            AudioFormat.ENCODING_PCM_FLOAT,
        )
        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                    .build(),
            )
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(maxOf(minimum, samples.size * Float.SIZE_BYTES * 4))
            .build()
        try {
            track.play()
            while (active.get()) {
                NativeBridge.audioFill(samples, frames)
                track.write(samples, 0, samples.size, AudioTrack.WRITE_BLOCKING)
            }
        } finally {
            track.pause()
            track.flush()
            track.release()
        }
    }

    private companion object {
        const val SAMPLE_RATE = 44_100
    }
}
