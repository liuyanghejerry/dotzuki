cmake_minimum_required(VERSION 3.22.1)
project(dotzuki_android LANGUAGES C CXX)

add_library(dotzuki_runner_mobile STATIC IMPORTED)
set_target_properties(dotzuki_runner_mobile PROPERTIES
    IMPORTED_LOCATION
    ${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libdotzuki_runner_mobile.a)

add_library(dotzuki_android SHARED native_bridge.cpp)
target_compile_features(dotzuki_android PRIVATE cxx_std_17)
target_include_directories(dotzuki_android PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)

find_library(ANDROID_LIB android)
find_library(LOG_LIB log)
target_link_libraries(dotzuki_android PRIVATE
    dotzuki_runner_mobile
    ${ANDROID_LIB}
    ${LOG_LIB}
    dl
    m)
