//! Script-side randomness shared by Boa and native scene activations.
const DEFAULT_SEED: u64 = 0x9E37_79B9_7F4A_7C15;

/// The xorshift64 stream used by `game.showRandomText`.
#[derive(Debug)]
pub struct ScriptRng(u64);

impl Default for ScriptRng {
    fn default() -> Self {
        Self(DEFAULT_SEED)
    }
}

impl ScriptRng {
    /// Reset the stream. Zero selects the default nonzero seed.
    pub fn seed(&mut self, seed: u64) {
        self.0 = if seed == 0 { DEFAULT_SEED } else { seed };
    }

    /// Mix in entropy from the game's RNG.
    pub fn mix(&mut self, entropy: u64) {
        self.seed(self.0 ^ entropy.wrapping_mul(0x2545_F491_4F6C_DD1D));
    }

    /// Draw an index. An empty list consumes no randomness.
    pub fn choose_index(&mut self, len: usize) -> Option<usize> {
        if len == 0 {
            return None;
        }
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        Some((self.0 % len as u64) as usize)
    }
}
