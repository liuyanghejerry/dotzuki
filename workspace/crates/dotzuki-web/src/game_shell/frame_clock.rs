//! Fixed hardware ticks on a browser refresh clock, including 120/144 Hz screens.
const FRAME_MS: f64 = 1_000.0 * 70_224.0 / 4_194_304.0;

#[derive(Default)]
pub(super) struct FrameClock {
    next: Option<f64>,
}

impl FrameClock {
    pub fn steps_at(&mut self, now: f64) -> u8 {
        let next = self.next.unwrap_or(now);
        if now < next {
            return 0;
        }
        let due = ((now - next) / FRAME_MS).floor() + 1.0;
        if due > 5.0 {
            // Returning from a hidden tab must not replay seconds of inputs,
            // sound or scene transitions. Resume the hardware clock here.
            self.next = Some(now + FRAME_MS);
            1
        } else {
            self.next = Some(next + due * FRAME_MS);
            due as u8
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ten_seconds_of_game_time_is_independent_of_display_refresh() {
        for refresh in [30, 60, 90, 120, 144, 240] {
            let mut clock = FrameClock::default();
            let ticks: u32 = (0..=refresh * 10)
                .map(|frame| {
                    u32::from(clock.steps_at(f64::from(frame) * 1000.0 / f64::from(refresh)))
                })
                .sum();
            assert_eq!(ticks, 598, "{refresh} Hz display");
        }
    }

    #[test]
    fn late_paints_catch_up_but_a_suspended_tab_does_not() {
        let mut clock = FrameClock::default();
        assert_eq!(clock.steps_at(0.0), 1);
        assert_eq!(clock.steps_at(10.0), 0);
        assert_eq!(clock.steps_at(33.5), 2);
        assert_eq!(clock.steps_at(50.3), 1);
        assert_eq!(clock.steps_at(60.0), 0);
        assert_eq!(clock.steps_at(5000.0), 1);
        assert_eq!(clock.steps_at(5001.0), 0);
        assert_eq!(clock.steps_at(5016.8), 1);
    }
}
