// Controlled byte-stream note-onset observations, not Rust-generated expectations.
// Captured from pinned source ROM SHA-256: 5ca7ba01642a3b27b0cc0b5349b52792795b62d3ed977e98a09390659af96b7b
// Reproduce with open-pokered docs/audits/hof-pc-load/generate-pitch-slide.py --engine-cases.
// Each row was checked on both source music banks and all three tonal channels.
// Fields: note, octave, target command, delay, modifier, perfect, low, high,
//         slide current, slide target, step, fractional step, slide flags.
&[
    [0, 4, 57, 6, 0, 0, 252, 134, 1797, 1973, 30, 2, 16],
    [0, 4, 57, 6, 0, 1, 253, 134, 1797, 1973, 30, 2, 17],
    [7, 4, 57, 6, 0, 0, 253, 128, 1880, 1973, 16, 3, 16],
    [7, 4, 57, 6, 0, 1, 254, 128, 1880, 1973, 16, 3, 17],
    [0, 5, 73, 6, 0, 0, 254, 131, 1547, 1899, 59, 4, 16],
    [0, 5, 73, 6, 0, 1, 255, 131, 1547, 1899, 59, 4, 17],
    [7, 5, 73, 6, 0, 0, 252, 197, 1713, 1899, 117, 2, 16],
    [7, 5, 73, 6, 0, 1, 253, 197, 1713, 1899, 117, 2, 17],
    [0, 5, 73, 7, 0, 0, 251, 131, 1547, 1899, 51, 2, 16],
    [0, 5, 73, 7, 0, 1, 252, 131, 1547, 1899, 51, 2, 17],
    [7, 5, 73, 7, 0, 0, 254, 196, 1713, 1899, 100, 5, 16],
    [7, 5, 73, 7, 0, 1, 255, 196, 1713, 1899, 100, 5, 17],
    [0, 4, 71, 1, 0, 0, 255, 196, 1797, 1880, 84, 0, 16],
    [0, 4, 71, 1, 0, 1, 0, 196, 1797, 1880, 84, 0, 17],
    [7, 4, 64, 6, 0, 0, 255, 134, 1880, 1797, 14, 5, 48],
    [7, 4, 64, 6, 0, 1, 0, 134, 1880, 1797, 14, 5, 49],
]
