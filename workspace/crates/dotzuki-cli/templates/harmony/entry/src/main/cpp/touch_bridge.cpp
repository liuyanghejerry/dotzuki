#include <napi/native_api.h>
#include "dotzuki_touch.hpp"

namespace {
// ArkUI invokes these functions on its UI thread.
dotzuki::touch::Controller controller;
dotzuki::touch::GameTap gameTap;
napi_value Configure(napi_env env, napi_callback_info info) {
    size_t count = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    bool array = false;
    uint32_t length = 0;
    if (count == 1) napi_is_array(env, args[0], &array);
    if (array) napi_get_array_length(env, args[0], &length);
    if (length != 10) { napi_throw_type_error(env, nullptr, "touchConfigure expects ten numbers"); return nullptr; }
    double values[10]{};
    for (uint32_t i = 0; i < 10; ++i) {
        napi_value value;
        napi_get_element(env, args[0], i, &value);
        if (napi_get_value_double(env, value, &values[i]) != napi_ok) return nullptr;
    }
    dotzuki::touch::Options options;
    options.scale = values[4]; options.inset = values[5]; options.lift = values[6];
    options.mirrored = values[7] != 0; options.floating = values[8] != 0;
    gameTap.reset();
    controller.layout({static_cast<float>(values[0]), static_cast<float>(values[1]),
        static_cast<float>(values[2]), static_cast<float>(values[3])}, options, static_cast<float>(values[9]));
    napi_value result;
    napi_get_undefined(env, &result);
    return result;
}
napi_value Layout(napi_env env, napi_callback_info) {
    napi_value result;
    napi_create_array_with_length(env, 30, &result);
    uint32_t index = 0;
    for (const auto &control : controller.controls) {
        for (float n : {static_cast<float>(control.id), control.bounds.x,
                       control.bounds.y, control.bounds.w, control.bounds.h}) {
            napi_value value;
            napi_create_double(env, n, &value);
            napi_set_element(env, result, index++, value);
        }
    }
    return result;
}
napi_value Event(napi_env env, napi_callback_info info) {
    size_t count = 4;
    napi_value args[4];
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    if (count != 4) { napi_throw_type_error(env, nullptr, "touchEvent expects kind, id, x, y"); return nullptr; }
    int32_t kind = 3, id = 0;
    double x = 0, y = 0;
    napi_get_value_int32(env, args[0], &kind); napi_get_value_int32(env, args[1], &id);
    napi_get_value_double(env, args[2], &x); napi_get_value_double(env, args[3], &y);
    bool tap = gameTap.event(kind, id, x, y, controller.accepts(x, y));
    bool settings = controller.event(kind, id, x, y);
    napi_value result;
    napi_create_int32(env, controller.bits() | (settings ? 256 : 0) | (tap ? 512 : 0), &result);
    return result;
}
}
uint8_t SampleTouchInput(uint8_t held) { return controller.sample(held); }

void ExportTouchFunctions(napi_env env, napi_value exports) {
    napi_property_descriptor functions[] = {
        {"touchConfigure", nullptr, Configure, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"touchLayout", nullptr, Layout, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"touchEvent", nullptr, Event, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, 3, functions);
}
