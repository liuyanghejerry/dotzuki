// Included at game module scope, after runtime.rs.
const NAVIGATION_NODE_LIMIT: usize = 16_384;

impl RunnerGame {
    /// Request a walk to a framebuffer pixel (origin at top left). UI states and
    /// pixels outside the game frame are ignored. Resolve world coordinates now,
    /// so subsequent camera movement cannot shift the clicked destination.
    /// `true` means accepted for planning; an unreachable tile flashes red.
    pub fn click_to_move(&mut self, x: f32, y: f32) -> bool {
        if !matches!(self.mode, Mode::Overworld)
            || self.transition.is_some()
            || !x.is_finite()
            || !y.is_finite()
            || x < 0.0
            || y < 0.0
            || x >= SCREEN_W as f32
            || y >= SCREEN_H as f32
        {
            return false;
        }
        let Some(map) = &self.map else {
            return false;
        };
        // Match draw(): rounded camera translation, no world zoom in the runner.
        let (tw, th) = map.tile_size();
        let tx = ((x + self.camera.position.x.round()) / tw as f32).floor() as i32;
        let ty = ((y + self.camera.position.y.round()) / th as f32).floor() as i32;
        let in_map = tx >= 0 && ty >= 0 && tx < map.width() as i32 && ty < map.height() as i32;
        if !in_map {
            return false;
        }
        self.cancel_navigation();
        self.pending_destination = Some((tx, ty));
        true
    }

    /// Cancel queued and active navigation; a started tile step still completes.
    pub fn cancel_navigation(&mut self) {
        self.navigation.cancel();
        self.pending_destination = None;
        self.navigation_failure = None;
    }

    /// Requested or active tile destination, excluding rejected destinations.
    pub fn navigation_target(&self) -> Option<(i32, i32)> {
        self.pending_destination
            .or_else(|| self.navigation.goal().map(|n| (n.x, n.y)))
    }

    fn navigation_direction(&mut self) -> Option<Direction> {
        // tile() is already the next tile while moving. Wait for the completed
        // step and its stairs/events before planning a replacement route.
        if self.actor.is_moving() {
            return None;
        }
        let map = self.map.as_ref()?;
        let (x, y) = self.actor.tile();
        let current = NavNode {
            x,
            y,
            level: self.actor.elevation(),
        };
        let world = NavigationView {
            map,
            start: current,
        };
        if let Some((x, y)) = self.pending_destination.take() {
            let goal = NavNode {
                x,
                y,
                level: if (x, y) == (current.x, current.y) {
                    current.level
                } else {
                    stair_level(map, current.level, x, y)
                },
            };
            if self
                .navigation
                .navigate_to(&world, current, goal, NAVIGATION_NODE_LIMIT)
                .is_err()
            {
                self.navigation_failure = Some((x, y, 45));
                return None;
            }
        }
        let goal = self.navigation.goal();
        match self
            .navigation
            .next_direction(&world, current, NAVIGATION_NODE_LIMIT)
        {
            Ok(direction) => direction,
            Err(_) => {
                self.navigation_failure = goal.map(|n| (n.x, n.y, 45));
                None
            }
        }
    }

    fn draw_navigation_marker(&self, fb: &mut FrameBuffer, cam_x: i32, cam_y: i32) {
        let Some(map) = &self.map else {
            return;
        };
        let marker = self
            .navigation_failure
            .map(|(x, y, _)| ((x, y), Rgba::rgb(255, 80, 80)))
            .or_else(|| {
                self.navigation_target()
                    .map(|p| (p, Rgba::rgb(255, 230, 100)))
            });
        let Some(((x, y), color)) = marker else {
            return;
        };
        let (tw, th) = map.tile_size();
        let (left, top) = (x * tw as i32 - cam_x, y * th as i32 - cam_y);
        for dx in 2..tw as i32 - 2 {
            for dy in [2, th as i32 - 3] {
                fb.set_pixel((left + dx) as u32, (top + dy) as u32, color);
            }
        }
        for dy in 2..th as i32 - 2 {
            for dx in [2, tw as i32 - 3] {
                fb.set_pixel((left + dx) as u32, (top + dy) as u32, color);
            }
        }
    }
}
