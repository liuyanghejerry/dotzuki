//! Bounded, deterministic navigation over caller-supplied movement transitions.
//! The caller executes returned directions through its normal movement system.
use super::types::Direction;
use crate::hash::HashMap;
use alloc::collections::VecDeque;

/// A tile and its collision layer. Coordinates are independent of pixel size.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct NavNode {
    pub x: i32,
    pub y: i32,
    pub level: u8,
}

/// Read-only movement rules, including occupancy, directional edges, and stairs.
/// Return the state *after completing* the step, or `None` for a blocked edge.
/// A transition must have the same meaning as executing that direction in game.
pub trait NavigationWorld {
    fn transition(&self, from: NavNode, direction: Direction) -> Option<NavNode>;
}

/// One movement command and the state its completion must produce.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NavStep {
    pub from: NavNode,
    pub to: NavNode,
    pub direction: Direction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigationError {
    Unreachable,
    SearchLimit,
}

/// Find a shortest route by number of movement commands using breadth-first search.
/// `max_nodes` bounds memory and work, including for unbounded provider worlds.
/// Neighbor order is fixed; no result depends on hash iteration order.
pub fn find_route(
    world: &impl NavigationWorld,
    start: NavNode,
    goal: NavNode,
    max_nodes: usize,
) -> Result<VecDeque<NavStep>, NavigationError> {
    if start == goal {
        return Ok(VecDeque::new());
    }
    if max_nodes == 0 {
        return Err(NavigationError::SearchLimit);
    }
    let mut previous: HashMap<NavNode, Option<NavStep>> = HashMap::default();
    let mut queue = VecDeque::from([start]);
    previous.insert(start, None);
    while let Some(from) = queue.pop_front() {
        for direction in [
            Direction::Up,
            Direction::Down,
            Direction::Left,
            Direction::Right,
        ] {
            let Some(to) = world.transition(from, direction) else {
                continue;
            };
            if previous.contains_key(&to) {
                continue;
            }
            if previous.len() >= max_nodes {
                return Err(NavigationError::SearchLimit);
            }
            previous.insert(
                to,
                Some(NavStep {
                    from,
                    to,
                    direction,
                }),
            );
            if to == goal {
                let mut route = VecDeque::new();
                let mut node = goal;
                while let Some(step) = previous[&node] {
                    route.push_front(step);
                    node = step.from;
                }
                return Ok(route);
            }
            queue.push_back(to);
        }
    }
    Err(NavigationError::Unreachable)
}

/// A route follower. Query only between completed steps, after game events run.
/// Revalidates each next edge and replans once per query if the world changed.
#[derive(Debug, Clone, Default)]
pub struct Navigator {
    goal: Option<NavNode>,
    route: VecDeque<NavStep>,
}
impl Navigator {
    /// Active destination, or `None` after arrival, cancellation, or failure.
    pub fn goal(&self) -> Option<NavNode> {
        self.goal
    }
    /// Discard the destination and its route.
    pub fn cancel(&mut self) {
        self.goal = None;
        self.route.clear();
    }
    /// Replace the route. Failure also discards any previous destination.
    pub fn navigate_to(
        &mut self,
        world: &impl NavigationWorld,
        start: NavNode,
        goal: NavNode,
        max_nodes: usize,
    ) -> Result<(), NavigationError> {
        self.cancel();
        self.route = find_route(world, start, goal, max_nodes)?;
        self.goal = (start != goal).then_some(goal);
        Ok(())
    }
    /// Returns the direction to execute. Repeated calls at the same position do
    /// not consume a step; only observing its completed destination does.
    pub fn next_direction(
        &mut self,
        world: &impl NavigationWorld,
        current: NavNode,
        max_nodes: usize,
    ) -> Result<Option<Direction>, NavigationError> {
        let Some(goal) = self.goal else {
            return Ok(None);
        };
        if current == goal {
            self.cancel();
            return Ok(None);
        }
        if self.route.front().is_some_and(|step| step.to == current) {
            self.route.pop_front();
        }
        let valid = self.route.front().is_some_and(|step| {
            step.from == current && world.transition(current, step.direction) == Some(step.to)
        });
        if !valid {
            self.navigate_to(world, current, goal, max_nodes)?;
        }
        Ok(self.route.front().map(|step| step.direction))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Grid {
        blocked: Vec<(i32, i32)>,
        stairs: bool,
    }
    fn node(x: i32, y: i32) -> NavNode {
        NavNode { x, y, level: 0 }
    }
    impl NavigationWorld for Grid {
        fn transition(&self, from: NavNode, dir: Direction) -> Option<NavNode> {
            let (dx, dy) = match dir {
                Direction::Up => (0, -1),
                Direction::Down => (0, 1),
                Direction::Left => (-1, 0),
                Direction::Right => (1, 0),
            };
            let mut to = NavNode {
                x: from.x.checked_add(dx)?,
                y: from.y.checked_add(dy)?,
                level: from.level,
            };
            if !(0..5).contains(&to.x)
                || !(0..5).contains(&to.y)
                || self.blocked.contains(&(to.x, to.y))
            {
                return None;
            }
            if self.stairs && (to.x, to.y) == (2, 1) {
                to.level = 1;
            }
            Some(to)
        }
    }
    #[test]
    fn shortest_detour_is_deterministic_and_bounded() {
        let world = Grid {
            blocked: vec![(2, 1)],
            stairs: false,
        };
        let route = find_route(&world, node(1, 1), node(3, 1), 25).unwrap();
        assert_eq!(route.len(), 4);
        assert_eq!(route.front().unwrap().direction, Direction::Up);
        assert_eq!(
            route,
            find_route(&world, node(1, 1), node(3, 1), 25).unwrap()
        );
        assert_eq!(
            find_route(&world, node(1, 1), node(3, 1), 1),
            Err(NavigationError::SearchLimit)
        );
        assert_eq!(
            find_route(&world, node(1, 1), node(2, 1), 25),
            Err(NavigationError::Unreachable)
        );
    }
    #[test]
    fn layers_are_distinct_search_states() {
        let world = Grid {
            blocked: vec![],
            stairs: true,
        };
        let goal = NavNode {
            level: 1,
            ..node(3, 1)
        };
        let route = find_route(&world, node(1, 1), goal, 50).unwrap();
        assert_eq!(route.len(), 2);
        assert_eq!(route[0].to.level, 1);
    }
    #[test]
    fn follower_replans_and_does_not_consume_unfinished_steps() {
        let mut world = Grid {
            blocked: vec![],
            stairs: false,
        };
        let mut nav = Navigator::default();
        nav.navigate_to(&world, node(1, 1), node(3, 1), 25).unwrap();
        for _ in 0..2 {
            assert_eq!(
                nav.next_direction(&world, node(1, 1), 25),
                Ok(Some(Direction::Right))
            );
        }
        world.blocked.push((2, 1));
        assert_eq!(
            nav.next_direction(&world, node(1, 1), 25),
            Ok(Some(Direction::Up))
        );
        let mut current = node(1, 1);
        for _ in 0..10 {
            if let Some(dir) = nav.next_direction(&world, current, 25).unwrap() {
                current = world.transition(current, dir).unwrap();
            }
        }
        assert_eq!(current, node(3, 1));
        assert_eq!(nav.goal(), None);
        nav.navigate_to(&world, current, node(1, 1), 25).unwrap();
        nav.cancel();
        assert_eq!(nav.next_direction(&world, current, 25), Ok(None));
    }
    #[test]
    fn failed_replacement_discards_old_route() {
        let world = Grid {
            blocked: vec![(2, 1)],
            stairs: false,
        };
        let mut nav = Navigator::default();
        nav.navigate_to(&world, node(1, 1), node(3, 1), 25).unwrap();
        assert!(nav.navigate_to(&world, node(1, 1), node(2, 1), 25).is_err());
        assert_eq!(nav.goal(), None);
    }
}
