#include "dotzuki_host.h"

#include <napi/native_api.h>

extern "C" napi_value Init(napi_env env, napi_value exports) {
    auto &host = DotzukiHost::Instance();
    host.RegisterXComponent(env, exports);
    host.ExportFunctions(env, exports);
    return exports;
}

static napi_module module = {
    .nm_version = 1,
    .nm_flags = 0,
    .nm_filename = nullptr,
    .nm_register_func = Init,
    .nm_modname = "entry",
    .nm_priv = nullptr,
    .reserved = {0},
};

extern "C" __attribute__((constructor)) void RegisterDotzukiModule() {
    napi_module_register(&module);
}
