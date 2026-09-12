#ifndef DOTZUKI_RUNNER_MOBILE_H
#define DOTZUKI_RUNNER_MOBILE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct MobileRuntime DotzukiMobileRunner;

/* ABI version 1 threading contract:
 * - one game thread owns tick, frame copy, and save calls;
 * - one audio callback may call audio_fill concurrently;
 * - stop the audio callback before destroy.
 * Input bits 0..7 are A, B, Select, Start, Right, Left, Up, Down.
 * Query width/height/frame_len for RGBA8 dimensions. Audio is 44100 Hz stereo interleaved f32.
 */

uint32_t dotzuki_mobile_abi_version(void);
size_t dotzuki_mobile_last_error(uint8_t *output, size_t capacity);

DotzukiMobileRunner *dotzuki_mobile_create(
    const uint8_t *pack,
    size_t pack_len,
    const uint8_t *save,
    size_t save_len);
void dotzuki_mobile_destroy(DotzukiMobileRunner *runner);

uint32_t dotzuki_mobile_width(const DotzukiMobileRunner *runner);
uint32_t dotzuki_mobile_height(const DotzukiMobileRunner *runner);
size_t dotzuki_mobile_frame_len(const DotzukiMobileRunner *runner);
bool dotzuki_mobile_tick(DotzukiMobileRunner *runner, uint8_t input_bits);
size_t dotzuki_mobile_copy_frame(
    const DotzukiMobileRunner *runner,
    uint8_t *output,
    size_t capacity);

uint32_t dotzuki_mobile_audio_fill(
    const DotzukiMobileRunner *runner,
    float *output,
    uint32_t frames);

size_t dotzuki_mobile_export_save(
    const DotzukiMobileRunner *runner,
    uint8_t *output,
    size_t capacity);
bool dotzuki_mobile_import_save(
    DotzukiMobileRunner *runner,
    const uint8_t *save,
    size_t save_len);

#ifdef __cplusplus
}
#endif

#endif
