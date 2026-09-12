#include <jni.h>

#include <algorithm>
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>

#include "dotzuki_runner_mobile.h"

namespace {
constexpr uint32_t MOBILE_ABI_VERSION = 1;
std::mutex game_mutex;
DotzukiMobileRunner *runner = nullptr;

jbyteArray bytes_to_array(JNIEnv *env, const uint8_t *bytes, size_t length) {
    auto result = env->NewByteArray(static_cast<jsize>(length));
    if (result != nullptr && length > 0) {
        env->SetByteArrayRegion(
            result, 0, static_cast<jsize>(length), reinterpret_cast<const jbyte *>(bytes));
    }
    return result;
}
}  // namespace

extern "C" JNIEXPORT jint JNICALL
Java_com_dotzuki_player_NativeBridge_abiVersion(JNIEnv *, jobject) {
    return static_cast<jint>(dotzuki_mobile_abi_version());
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_dotzuki_player_NativeBridge_create(
    JNIEnv *env, jobject, jbyteArray pack_array, jbyteArray save_array) {
    if (pack_array == nullptr || dotzuki_mobile_abi_version() != MOBILE_ABI_VERSION) {
        return JNI_FALSE;
    }
    const jsize pack_length = env->GetArrayLength(pack_array);
    jbyte *pack = env->GetByteArrayElements(pack_array, nullptr);
    jbyte *save = nullptr;
    jsize save_length = 0;
    if (save_array != nullptr) {
        save_length = env->GetArrayLength(save_array);
        save = env->GetByteArrayElements(save_array, nullptr);
    }
    std::lock_guard<std::mutex> lock(game_mutex);
    if (runner != nullptr) {
        dotzuki_mobile_destroy(runner);
    }
    runner = dotzuki_mobile_create(
        reinterpret_cast<const uint8_t *>(pack), static_cast<size_t>(pack_length),
        reinterpret_cast<const uint8_t *>(save), static_cast<size_t>(save_length));
    if (save != nullptr) env->ReleaseByteArrayElements(save_array, save, JNI_ABORT);
    env->ReleaseByteArrayElements(pack_array, pack, JNI_ABORT);
    return runner == nullptr ? JNI_FALSE : JNI_TRUE;
}

extern "C" JNIEXPORT void JNICALL
Java_com_dotzuki_player_NativeBridge_destroy(JNIEnv *, jobject) {
    std::lock_guard<std::mutex> lock(game_mutex);
    if (runner != nullptr) {
        dotzuki_mobile_destroy(runner);
        runner = nullptr;
    }
}

extern "C" JNIEXPORT jint JNICALL
Java_com_dotzuki_player_NativeBridge_width(JNIEnv *, jobject) {
    std::lock_guard<std::mutex> lock(game_mutex);
    return runner == nullptr ? 0 : static_cast<jint>(dotzuki_mobile_width(runner));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_dotzuki_player_NativeBridge_height(JNIEnv *, jobject) {
    std::lock_guard<std::mutex> lock(game_mutex);
    return runner == nullptr ? 0 : static_cast<jint>(dotzuki_mobile_height(runner));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_dotzuki_player_NativeBridge_frameLength(JNIEnv *, jobject) {
    std::lock_guard<std::mutex> lock(game_mutex);
    return runner == nullptr ? 0 : static_cast<jint>(dotzuki_mobile_frame_len(runner));
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_dotzuki_player_NativeBridge_tick(JNIEnv *, jobject, jint input_bits) {
    std::lock_guard<std::mutex> lock(game_mutex);
    return runner != nullptr && dotzuki_mobile_tick(runner, static_cast<uint8_t>(input_bits));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_dotzuki_player_NativeBridge_copyFrame(JNIEnv *env, jobject, jobject output) {
    auto *bytes = static_cast<uint8_t *>(env->GetDirectBufferAddress(output));
    const jlong capacity = env->GetDirectBufferCapacity(output);
    if (bytes == nullptr || capacity < 0) return 0;
    std::lock_guard<std::mutex> lock(game_mutex);
    return runner == nullptr ? 0 : static_cast<jint>(
        dotzuki_mobile_copy_frame(runner, bytes, static_cast<size_t>(capacity)));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_dotzuki_player_NativeBridge_audioFill(
    JNIEnv *env, jobject, jfloatArray output_array, jint frames) {
    if (output_array == nullptr || frames <= 0) return 0;
    const jsize sample_count = env->GetArrayLength(output_array);
    const uint32_t requested = std::min<uint32_t>(
        static_cast<uint32_t>(frames), static_cast<uint32_t>(sample_count / 2));
    jfloat *output = env->GetFloatArrayElements(output_array, nullptr);
    const uint32_t written = runner == nullptr ? 0 :
        dotzuki_mobile_audio_fill(runner, output, requested);
    std::fill(output + static_cast<size_t>(written) * 2, output + sample_count, 0.0f);
    env->ReleaseFloatArrayElements(output_array, output, 0);
    return static_cast<jint>(written);
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_dotzuki_player_NativeBridge_exportSave(JNIEnv *env, jobject) {
    std::lock_guard<std::mutex> lock(game_mutex);
    if (runner == nullptr) return nullptr;
    const size_t length = dotzuki_mobile_export_save(runner, nullptr, 0);
    if (length == 0) return nullptr;
    std::vector<uint8_t> bytes(length);
    if (dotzuki_mobile_export_save(runner, bytes.data(), bytes.size()) != length) return nullptr;
    return bytes_to_array(env, bytes.data(), bytes.size());
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_dotzuki_player_NativeBridge_lastError(JNIEnv *env, jobject) {
    const size_t length = dotzuki_mobile_last_error(nullptr, 0);
    if (length == 0) return env->NewStringUTF("");
    std::vector<uint8_t> bytes(length);
    dotzuki_mobile_last_error(bytes.data(), bytes.size());
    std::string message(bytes.begin(), bytes.end());
    return env->NewStringUTF(message.c_str());
}
