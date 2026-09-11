#ifndef DOTZUKI_HARMONY_HOST_H
#define DOTZUKI_HARMONY_HOST_H

#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES3/gl3.h>
#include <ace/xcomponent/native_interface_xcomponent.h>
#include <atomic>
#include <cstdint>
#include <js_native_api.h>
#include <mutex>
#include <ohaudio/native_audiorenderer.h>
#include <ohaudio/native_audiostreambuilder.h>
#include <vector>

#include "dotzuki_runner_mobile.h"

class DotzukiHost {
public:
    static DotzukiHost &Instance();
    bool RegisterXComponent(napi_env env, napi_value exports);
    void ExportFunctions(napi_env env, napi_value exports);

private:
    DotzukiHost() = default;
    ~DotzukiHost();
    DotzukiHost(const DotzukiHost &) = delete;
    DotzukiHost &operator=(const DotzukiHost &) = delete;

    static napi_value Start(napi_env env, napi_callback_info info);
    static napi_value SetInput(napi_env env, napi_callback_info info);
    static napi_value Pause(napi_env env, napi_callback_info info);
    static napi_value Resume(napi_env env, napi_callback_info info);
    static napi_value ExportSave(napi_env env, napi_callback_info info);

    static void SurfaceCreated(OH_NativeXComponent *component, void *window);
    static void SurfaceChanged(OH_NativeXComponent *component, void *window);
    static void SurfaceDestroyed(OH_NativeXComponent *component, void *window);
    static void TouchEvent(OH_NativeXComponent *component, void *window);
    static void Frame(
        OH_NativeXComponent *component, uint64_t timestamp, uint64_t targetTimestamp);

    static OH_AudioData_Callback_Result AudioWrite(
        OH_AudioRenderer *renderer, void *userData, void *data, int32_t size);
    static int32_t AudioInterrupt(OH_AudioRenderer *renderer, void *userData,
        OH_AudioInterrupt_ForceType type, OH_AudioInterrupt_Hint hint);
    static int32_t AudioError(
        OH_AudioRenderer *renderer, void *userData, OH_AudioStream_Result error);
    static int32_t AudioEvent(
        OH_AudioRenderer *renderer, void *userData, OH_AudioStream_Event event);

    bool InitializeEgl(void *window, uint64_t width, uint64_t height);
    bool InitializeProgram();
    bool InitializeAudio();
    void RenderFrame();
    void Resize(uint64_t width, uint64_t height);
    void ShutdownAudio();
    void ShutdownEgl();
    void ReplaceRunner(const uint8_t *pack, size_t packLen, const char *save, size_t saveLen);

    DotzukiMobileRunner *runner_ = nullptr;
    OH_NativeXComponent *component_ = nullptr;
    std::atomic<uint8_t> input_ { 0 };
    std::atomic<bool> paused_ { false };
    std::mutex gameMutex_;
    uint64_t surfaceWidth_ = 0;
    uint64_t surfaceHeight_ = 0;

    EGLDisplay display_ = EGL_NO_DISPLAY;
    EGLSurface surface_ = EGL_NO_SURFACE;
    EGLContext context_ = EGL_NO_CONTEXT;
    GLuint program_ = 0;
    GLuint texture_ = 0;
    std::vector<uint8_t> frame_;

    OH_AudioStreamBuilder *audioBuilder_ = nullptr;
    OH_AudioRenderer *audioRenderer_ = nullptr;
};

#endif
