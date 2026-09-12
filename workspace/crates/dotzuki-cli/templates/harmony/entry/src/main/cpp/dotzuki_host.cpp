#include "dotzuki_host.h"

#include <algorithm>
#include <cmath>
#include <chrono>
#include <cstring>
#include <string>

#include <hilog/log.h>
#include <js_native_api_types.h>

namespace {
constexpr uint32_t DOTZUKI_LOG_DOMAIN = 0xD07A;
constexpr const char *DOTZUKI_LOG_TAG = "Dotzuki";
constexpr uint32_t MOBILE_ABI_VERSION = 1;

void LogError(const char *message) {
    OH_LOG_Print(
        LOG_APP, LOG_ERROR, DOTZUKI_LOG_DOMAIN, DOTZUKI_LOG_TAG, "%{public}s", message);
}

napi_value Undefined(napi_env env) {
    napi_value result = nullptr;
    napi_get_undefined(env, &result);
    return result;
}

GLuint CompileShader(GLenum type, const char *source) {
    GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &source, nullptr);
    glCompileShader(shader);
    GLint status = GL_FALSE;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &status);
    if (status != GL_TRUE) {
        glDeleteShader(shader);
        return 0;
    }
    return shader;
}

bool ReadBytes(napi_env env, napi_value value, uint8_t **data, size_t *length) {
    bool typed = false;
    napi_is_typedarray(env, value, &typed);
    if (!typed) {
        return false;
    }
    napi_typedarray_type type;
    size_t count = 0;
    void *raw = nullptr;
    napi_value arrayBuffer;
    size_t offset = 0;
    if (napi_get_typedarray_info(
            env, value, &type, &count, &raw, &arrayBuffer, &offset) != napi_ok ||
        type != napi_uint8_array) {
        return false;
    }
    *data = static_cast<uint8_t *>(raw);
    *length = count;
    return true;
}

std::string ReadString(napi_env env, napi_value value) {
    size_t length = 0;
    if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) {
        return {};
    }
    std::string result(length + 1, '\0');
    napi_get_value_string_utf8(env, value, result.data(), result.size(), &length);
    result.resize(length);
    return result;
}
} // namespace

DotzukiHost &DotzukiHost::Instance() {
    static DotzukiHost host;
    return host;
}

DotzukiHost::~DotzukiHost() {
    if (component_ != nullptr) {
        OH_NativeXComponent_UnregisterOnFrameCallback(component_);
    }
    ShutdownAudio();
    std::lock_guard<std::mutex> lock(gameMutex_);
    ShutdownEgl();
    if (runner_ != nullptr) {
        dotzuki_mobile_destroy(runner_);
        runner_ = nullptr;
    }
}

bool DotzukiHost::RegisterXComponent(napi_env env, napi_value exports) {
    napi_value nativeObject = nullptr;
    if (napi_get_named_property(env, exports, OH_NATIVE_XCOMPONENT_OBJ, &nativeObject) != napi_ok ||
        napi_unwrap(env, nativeObject, reinterpret_cast<void **>(&component_)) != napi_ok ||
        component_ == nullptr) {
        LogError("failed to acquire NativeXComponent");
        return false;
    }
    static OH_NativeXComponent_Callback callbacks {
        SurfaceCreated, SurfaceChanged, SurfaceDestroyed, TouchEvent
    };
    if (OH_NativeXComponent_RegisterCallback(component_, &callbacks) !=
        OH_NATIVEXCOMPONENT_RESULT_SUCCESS) {
        return false;
    }
    return OH_NativeXComponent_RegisterOnFrameCallback(component_, Frame) ==
        OH_NATIVEXCOMPONENT_RESULT_SUCCESS;
}

void DotzukiHost::ExportFunctions(napi_env env, napi_value exports) {
    napi_property_descriptor functions[] = {
        {"start", nullptr, Start, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"setInput", nullptr, SetInput, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"pause", nullptr, Pause, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"resume", nullptr, Resume, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"exportSave", nullptr, ExportSave, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, sizeof(functions) / sizeof(functions[0]), functions);
}

napi_value DotzukiHost::Start(napi_env env, napi_callback_info info) {
    if (dotzuki_mobile_abi_version() != MOBILE_ABI_VERSION) {
        napi_throw_error(env, nullptr, "unsupported dotzuki mobile ABI version");
        return nullptr;
    }
    size_t count = 2;
    napi_value args[2] = {nullptr, nullptr};
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    uint8_t *pack = nullptr;
    size_t packLen = 0;
    if (count < 1 || !ReadBytes(env, args[0], &pack, &packLen)) {
        napi_throw_type_error(env, nullptr, "start expects a Uint8Array game pack");
        return nullptr;
    }
    std::string save;
    if (count > 1) {
        save = ReadString(env, args[1]);
    }
    auto &host = Instance();
    host.ReplaceRunner(pack, packLen, save.empty() ? nullptr : save.data(), save.size());
    napi_value result = nullptr;
    napi_get_boolean(env, host.runner_ != nullptr, &result);
    return result;
}

napi_value DotzukiHost::SetInput(napi_env env, napi_callback_info info) {
    size_t count = 1;
    napi_value arg = nullptr;
    napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr);
    uint32_t bits = 0;
    if (count == 1) {
        napi_get_value_uint32(env, arg, &bits);
    }
    Instance().input_.store(static_cast<uint8_t>(bits), std::memory_order_relaxed);
    return Undefined(env);
}

napi_value DotzukiHost::Pause(napi_env env, napi_callback_info info) {
    (void)info;
    auto &host = Instance();
    host.paused_.store(true, std::memory_order_release);
    host.input_.store(0, std::memory_order_relaxed);
    if (host.audioRenderer_ != nullptr) {
        OH_AudioRenderer_Pause(host.audioRenderer_);
    }
    return Undefined(env);
}

napi_value DotzukiHost::Resume(napi_env env, napi_callback_info info) {
    (void)info;
    auto &host = Instance();
    host.paused_.store(false, std::memory_order_release);
    if (host.audioRenderer_ != nullptr) {
        OH_AudioRenderer_Start(host.audioRenderer_);
    }
    return Undefined(env);
}

napi_value DotzukiHost::ExportSave(napi_env env, napi_callback_info info) {
    (void)info;
    auto &host = Instance();
    std::lock_guard<std::mutex> lock(host.gameMutex_);
    if (host.runner_ == nullptr) {
        return Undefined(env);
    }
    size_t length = dotzuki_mobile_export_save(host.runner_, nullptr, 0);
    if (length == 0) {
        return Undefined(env);
    }
    void *data = nullptr;
    napi_value arrayBuffer = nullptr;
    napi_create_arraybuffer(env, length, &data, &arrayBuffer);
    if (dotzuki_mobile_export_save(
            host.runner_, static_cast<uint8_t *>(data), length) != length) {
        return Undefined(env);
    }
    napi_value result = nullptr;
    napi_create_typedarray(env, napi_uint8_array, length, arrayBuffer, 0, &result);
    return result;
}

void DotzukiHost::SurfaceCreated(OH_NativeXComponent *component, void *window) {
    uint64_t width = 0;
    uint64_t height = 0;
    if (component != nullptr && window != nullptr &&
        OH_NativeXComponent_GetXComponentSize(component, window, &width, &height) ==
            OH_NATIVEXCOMPONENT_RESULT_SUCCESS) {
        auto &host = Instance();
        std::lock_guard<std::mutex> lock(host.gameMutex_);
        host.InitializeEgl(window, width, height);
    }
}

void DotzukiHost::SurfaceChanged(OH_NativeXComponent *component, void *window) {
    uint64_t width = 0;
    uint64_t height = 0;
    if (component != nullptr && window != nullptr &&
        OH_NativeXComponent_GetXComponentSize(component, window, &width, &height) ==
            OH_NATIVEXCOMPONENT_RESULT_SUCCESS) {
        auto &host = Instance();
        std::lock_guard<std::mutex> lock(host.gameMutex_);
        host.Resize(width, height);
    }
}

void DotzukiHost::SurfaceDestroyed(OH_NativeXComponent *component, void *window) {
    (void)component;
    (void)window;
    auto &host = Instance();
    std::lock_guard<std::mutex> lock(host.gameMutex_);
    host.ShutdownEgl();
}

void DotzukiHost::TouchEvent(OH_NativeXComponent *component, void *window) {
    (void)component;
    (void)window;
}

void DotzukiHost::Frame(
    OH_NativeXComponent *component, uint64_t timestamp, uint64_t targetTimestamp) {
    (void)component;
    (void)targetTimestamp;
    (void)timestamp;
    const auto now = std::chrono::steady_clock::now().time_since_epoch();
    Instance().RenderFrame(std::chrono::duration_cast<std::chrono::nanoseconds>(now).count());
}

void DotzukiHost::ReplaceRunner(
    const uint8_t *pack, size_t packLen, const char *save, size_t saveLen) {
    ShutdownAudio();
    std::lock_guard<std::mutex> lock(gameMutex_);
    if (runner_ != nullptr) {
        dotzuki_mobile_destroy(runner_);
    }
    runner_ = dotzuki_mobile_create(
        pack, packLen, reinterpret_cast<const uint8_t *>(save), saveLen);
    if (runner_ == nullptr) {
        LogError("Rust mobile runtime rejected the game pack");
        return;
    }
    lastTimestamp_ = 0;
    accumulator_ = 0;
    frame_.resize(dotzuki_mobile_frame_len(runner_));
    InitializeAudio();
}

bool DotzukiHost::InitializeEgl(void *window, uint64_t width, uint64_t height) {
    ShutdownEgl();
    display_ = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    if (display_ == EGL_NO_DISPLAY || !eglInitialize(display_, nullptr, nullptr)) {
        LogError("eglInitialize failed");
        return false;
    }
    const EGLint attributes[] = {
        EGL_SURFACE_TYPE, EGL_WINDOW_BIT,
        EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT_KHR,
        EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8,
        EGL_NONE
    };
    EGLConfig config;
    EGLint count = 0;
    if (!eglChooseConfig(display_, attributes, &config, 1, &count) || count == 0) {
        LogError("eglChooseConfig failed");
        return false;
    }
    const EGLint contextAttributes[] = {EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE};
    context_ = eglCreateContext(display_, config, EGL_NO_CONTEXT, contextAttributes);
    surface_ = eglCreateWindowSurface(
        display_, config, reinterpret_cast<EGLNativeWindowType>(window), nullptr);
    if (context_ == EGL_NO_CONTEXT || surface_ == EGL_NO_SURFACE ||
        !eglMakeCurrent(display_, surface_, surface_, context_)) {
        LogError("EGL surface or context creation failed");
        ShutdownEgl();
        return false;
    }
    Resize(width, height);
    return InitializeProgram();
}

bool DotzukiHost::InitializeProgram() {
    static const char *vertex = R"(#version 300 es
        out vec2 uv;
        const vec2 positions[4] = vec2[4](
            vec2(-1.0, -1.0), vec2(1.0, -1.0),
            vec2(-1.0, 1.0), vec2(1.0, 1.0));
        const vec2 texCoords[4] = vec2[4](
            vec2(0.0, 1.0), vec2(1.0, 1.0),
            vec2(0.0, 0.0), vec2(1.0, 0.0));
        void main() {
            gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
            uv = texCoords[gl_VertexID];
        }
    )";
    static const char *fragment = R"(#version 300 es
        precision mediump float;
        uniform sampler2D frameTexture;
        in vec2 uv;
        out vec4 color;
        void main() { color = texture(frameTexture, uv); }
    )";
    GLuint vs = CompileShader(GL_VERTEX_SHADER, vertex);
    GLuint fs = CompileShader(GL_FRAGMENT_SHADER, fragment);
    if (vs == 0 || fs == 0) {
        LogError("shader compilation failed");
        return false;
    }
    program_ = glCreateProgram();
    glAttachShader(program_, vs);
    glAttachShader(program_, fs);
    glLinkProgram(program_);
    glDeleteShader(vs);
    glDeleteShader(fs);
    GLint linked = GL_FALSE;
    glGetProgramiv(program_, GL_LINK_STATUS, &linked);
    if (linked != GL_TRUE) {
        LogError("shader linking failed");
        return false;
    }
    glGenTextures(1, &texture_);
    glBindTexture(GL_TEXTURE_2D, texture_);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

    return true;
}

void DotzukiHost::RenderFrame(uint64_t timestamp) {
    std::lock_guard<std::mutex> lock(gameMutex_);
    if (runner_ == nullptr || paused_.load(std::memory_order_acquire) ||
        display_ == EGL_NO_DISPLAY || surface_ == EGL_NO_SURFACE) {
        lastTimestamp_ = 0;
        accumulator_ = 0;
        return;
    }
    if (!eglMakeCurrent(display_, surface_, surface_, context_)) {
        return;
    }
    constexpr double step = 1.0 / 59.7275;
    if (lastTimestamp_ == 0 || timestamp < lastTimestamp_) {
        accumulator_ = step;
    } else {
        accumulator_ += std::min(static_cast<double>(timestamp - lastTimestamp_) / 1e9, step * 4);
    }
    lastTimestamp_ = timestamp;
    while (accumulator_ >= step) {
        if (!dotzuki_mobile_tick(runner_, input_.load(std::memory_order_relaxed))) return;
        accumulator_ -= step;
    }
    if (dotzuki_mobile_copy_frame(runner_, frame_.data(), frame_.size()) != frame_.size()) {
        return;
    }

    const float gameAspect = static_cast<float>(dotzuki_mobile_width(runner_)) / dotzuki_mobile_height(runner_);
    const float surfaceAspect = static_cast<float>(surfaceWidth_) /
        static_cast<float>(std::max<uint64_t>(surfaceHeight_, 1));
    GLint x = 0;
    GLint y = 0;
    GLsizei width = static_cast<GLsizei>(surfaceWidth_);
    GLsizei height = static_cast<GLsizei>(surfaceHeight_);
    if (surfaceAspect > gameAspect) {
        width = static_cast<GLsizei>(height * gameAspect);
        x = (static_cast<GLint>(surfaceWidth_) - width) / 2;
    } else {
        height = static_cast<GLsizei>(width / gameAspect);
        y = (static_cast<GLint>(surfaceHeight_) - height) / 2;
    }
    glViewport(0, 0, static_cast<GLsizei>(surfaceWidth_),
        static_cast<GLsizei>(surfaceHeight_));
    glClearColor(0, 0, 0, 1);
    glClear(GL_COLOR_BUFFER_BIT);
    glViewport(x, y, width, height);
    glUseProgram(program_);
    glBindTexture(GL_TEXTURE_2D, texture_);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, dotzuki_mobile_width(runner_), dotzuki_mobile_height(runner_), 0, GL_RGBA, GL_UNSIGNED_BYTE, frame_.data());
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
    eglSwapBuffers(display_, surface_);
}

void DotzukiHost::Resize(uint64_t width, uint64_t height) {
    surfaceWidth_ = width;
    surfaceHeight_ = height;
}

void DotzukiHost::ShutdownEgl() {
    if (display_ != EGL_NO_DISPLAY) {
        if (surface_ != EGL_NO_SURFACE && context_ != EGL_NO_CONTEXT) {
            eglMakeCurrent(display_, surface_, surface_, context_);
        }
        if (texture_ != 0) {
            glDeleteTextures(1, &texture_);
        }
        if (program_ != 0) {
            glDeleteProgram(program_);
        }
        eglMakeCurrent(display_, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
        if (surface_ != EGL_NO_SURFACE) {
            eglDestroySurface(display_, surface_);
        }
        if (context_ != EGL_NO_CONTEXT) {
            eglDestroyContext(display_, context_);
        }
        eglTerminate(display_);
    }
    display_ = EGL_NO_DISPLAY;
    surface_ = EGL_NO_SURFACE;
    context_ = EGL_NO_CONTEXT;
    texture_ = 0;
    program_ = 0;
}

bool DotzukiHost::InitializeAudio() {
    if (runner_ == nullptr ||
        OH_AudioStreamBuilder_Create(&audioBuilder_, AUDIOSTREAM_TYPE_RENDERER) !=
            AUDIOSTREAM_SUCCESS) {
        return false;
    }
    OH_AudioStreamBuilder_SetSamplingRate(audioBuilder_, 44100);
    OH_AudioStreamBuilder_SetChannelCount(audioBuilder_, 2);
    OH_AudioStreamBuilder_SetSampleFormat(audioBuilder_, AUDIOSTREAM_SAMPLE_S16LE);
    OH_AudioStreamBuilder_SetEncodingType(audioBuilder_, AUDIOSTREAM_ENCODING_TYPE_RAW);
    OH_AudioStreamBuilder_SetLatencyMode(audioBuilder_, AUDIOSTREAM_LATENCY_MODE_NORMAL);
    OH_AudioStreamBuilder_SetRendererInfo(audioBuilder_, AUDIOSTREAM_USAGE_GAME);
    OH_AudioRenderer_Callbacks callbacks {};
    callbacks.OH_AudioRenderer_OnStreamEvent = AudioEvent;
    callbacks.OH_AudioRenderer_OnInterruptEvent = AudioInterrupt;
    callbacks.OH_AudioRenderer_OnError = AudioError;
    OH_AudioStreamBuilder_SetRendererCallback(audioBuilder_, callbacks, this);
    OH_AudioStreamBuilder_SetRendererWriteDataCallback(audioBuilder_, AudioWrite, this);
    if (OH_AudioStreamBuilder_GenerateRenderer(audioBuilder_, &audioRenderer_) !=
        AUDIOSTREAM_SUCCESS) {
        ShutdownAudio();
        return false;
    }
    return OH_AudioRenderer_Start(audioRenderer_) == AUDIOSTREAM_SUCCESS;
}

OH_AudioData_Callback_Result DotzukiHost::AudioWrite(
    OH_AudioRenderer *renderer, void *userData, void *data, int32_t size) {
    (void)renderer;
    auto *host = static_cast<DotzukiHost *>(userData);
    auto *output = static_cast<int16_t *>(data);
    const uint32_t requestedFrames = static_cast<uint32_t>(size / (sizeof(int16_t) * 2));
    thread_local std::vector<float> pcm;
    pcm.resize(static_cast<size_t>(requestedFrames) * 2);
    uint32_t frames = host->runner_ == nullptr ? 0 :
        dotzuki_mobile_audio_fill(host->runner_, pcm.data(), requestedFrames);
    size_t samples = static_cast<size_t>(frames) * 2;
    for (size_t i = 0; i < samples; ++i) {
        float sample = std::clamp(pcm[i], -1.0f, 1.0f);
        output[i] = static_cast<int16_t>(std::lrint(sample * 32767.0f));
    }
    std::fill(output + samples, output + requestedFrames * 2, 0);
    return AUDIO_DATA_CALLBACK_RESULT_VALID;
}

int32_t DotzukiHost::AudioInterrupt(
    OH_AudioRenderer *renderer, void *userData, OH_AudioInterrupt_ForceType type,
    OH_AudioInterrupt_Hint hint) {
    auto *host = static_cast<DotzukiHost *>(userData);
    if (type == AUDIOSTREAM_INTERRUPT_FORCE && hint == AUDIOSTREAM_INTERRUPT_HINT_PAUSE) {
        OH_AudioRenderer_Pause(renderer);
    } else if (hint == AUDIOSTREAM_INTERRUPT_HINT_RESUME &&
        !host->paused_.load(std::memory_order_acquire)) {
        OH_AudioRenderer_Start(renderer);
    }
    return 0;
}

int32_t DotzukiHost::AudioError(
    OH_AudioRenderer *renderer, void *userData, OH_AudioStream_Result error) {
    (void)renderer;
    (void)userData;
    (void)error;
    LogError("OHAudio renderer error");
    return 0;
}

int32_t DotzukiHost::AudioEvent(
    OH_AudioRenderer *renderer, void *userData, OH_AudioStream_Event event) {
    (void)renderer;
    (void)userData;
    (void)event;
    return 0;
}

void DotzukiHost::ShutdownAudio() {
    if (audioRenderer_ != nullptr) {
        OH_AudioRenderer_Stop(audioRenderer_);
        OH_AudioRenderer_Release(audioRenderer_);
        audioRenderer_ = nullptr;
    }
    if (audioBuilder_ != nullptr) {
        OH_AudioStreamBuilder_Destroy(audioBuilder_);
        audioBuilder_ = nullptr;
    }
}
