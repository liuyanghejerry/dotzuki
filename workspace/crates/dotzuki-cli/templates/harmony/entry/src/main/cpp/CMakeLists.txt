cmake_minimum_required(VERSION 3.5.0)
project(dotzuki_harmony)

add_library(dotzuki_runner_mobile STATIC IMPORTED)
set_target_properties(dotzuki_runner_mobile PROPERTIES
  IMPORTED_LOCATION
    ${CMAKE_CURRENT_SOURCE_DIR}/../../../libs/${OHOS_ARCH}/libdotzuki_runner_mobile.a)

add_library(entry SHARED napi_init.cpp dotzuki_host.cpp)
target_include_directories(entry PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_compile_features(entry PRIVATE cxx_std_17)

find_library(EGL_LIB EGL)
find_library(GLES_LIB GLESv3)
find_library(HILOG_LIB hilog_ndk.z)
find_library(ACE_LIB ace_ndk.z)
find_library(NAPI_LIB ace_napi.z)
find_library(OHAUDIO_LIB ohaudio)

target_link_libraries(entry PUBLIC
  dotzuki_runner_mobile
  ${EGL_LIB}
  ${GLES_LIB}
  ${HILOG_LIB}
  ${ACE_LIB}
  ${NAPI_LIB}
  ${OHAUDIO_LIB})
