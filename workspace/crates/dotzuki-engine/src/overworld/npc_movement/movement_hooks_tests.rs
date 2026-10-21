use super::wander_policy_tests::{walker, Floor, OpenFloor};
use super::*;

#[derive(Debug, PartialEq, Eq)]
enum Event {
    Choose(usize),
    Gate(usize, Direction),
    Blocked(usize),
    Started(usize),
    Finished(usize, Direction, bool, u16, u16),
    Stationary(usize),
}

#[derive(Default)]
struct Decisions {
    events: Vec<Event>,
    denied: Option<usize>,
}
impl NpcMovementHooks for Decisions {
    fn choose_direction(&mut self, slot: usize, _: &NpcRuntimeState) -> Option<Direction> {
        self.events.push(Event::Choose(slot));
        Some(Direction::Down)
    }
    fn can_start_step(&mut self, slot: usize, _: &NpcRuntimeState, direction: Direction) -> bool {
        self.events.push(Event::Gate(slot, direction));
        self.denied != Some(slot)
    }
    fn step_blocked(&mut self, slot: usize, npc: &mut NpcRuntimeState) {
        self.events.push(Event::Blocked(slot));
        npc.delay_counter = 19;
    }
    fn step_started(&mut self, slot: usize, _: &mut NpcRuntimeState) {
        self.events.push(Event::Started(slot));
    }
    fn step_finished(
        &mut self,
        slot: usize,
        npc: &mut NpcRuntimeState,
        direction: Direction,
        scripted: bool,
    ) {
        self.events
            .push(Event::Finished(slot, direction, scripted, npc.x, npc.y));
        if !scripted {
            npc.delay_counter = 37;
        }
    }
    fn stationary(&mut self, slot: usize, npc: &mut NpcRuntimeState) {
        self.events.push(Event::Stationary(slot));
        npc.facing = Direction::Up;
    }
}

fn pass(npcs: &mut [NpcRuntimeState], hooks: &mut Decisions) {
    update_npc_movement_with_hooks(npcs, 0, 0, None, 10, 10, &[], Floor, &OpenFloor, hooks);
}

#[test]
fn decisions_and_outcomes_run_in_actor_order_with_no_start_delay_assumption() {
    let mut actors = vec![walker(NpcWanderAxis::Any), walker(NpcWanderAxis::Any)];
    actors[1].x = 8;
    actors[1].facing = Direction::Up;
    let mut hooks = Decisions {
        denied: Some(1),
        ..Default::default()
    };
    pass(&mut actors, &mut hooks);
    assert_eq!(
        hooks.events,
        vec![
            Event::Choose(0),
            Event::Gate(0, Direction::Down),
            Event::Started(0),
            Event::Choose(1),
            Event::Gate(1, Direction::Down),
            Event::Blocked(1),
        ]
    );
    assert_eq!((actors[0].walk_counter, actors[0].delay_counter), (16, 0));
    assert_eq!((actors[1].walk_counter, actors[1].delay_counter), (0, 19));
    assert_eq!(actors[1].facing, Direction::Down);
}

#[test]
fn completion_commits_the_stride_direction_before_the_next_actor_decides() {
    let mut actors = vec![walker(NpcWanderAxis::Any), walker(NpcWanderAxis::Any)];
    actors[0].walk_counter = 1;
    actors[0].step_direction = Some(Direction::Right);
    actors[0].facing = Direction::Up;
    actors[1].x = 8;
    let mut hooks = Decisions::default();
    pass(&mut actors, &mut hooks);
    assert_eq!(
        hooks.events,
        vec![
            Event::Finished(0, Direction::Right, false, 6, 5),
            Event::Choose(1),
            Event::Gate(1, Direction::Down),
            Event::Started(1)
        ]
    );
    assert_eq!(
        (
            actors[0].x,
            actors[0].y,
            actors[0].walk_counter,
            actors[0].delay_counter
        ),
        (6, 5, 0, 37)
    );
    assert_eq!(actors[0].facing, Direction::Up);
}

#[test]
fn scripted_completion_is_distinguished_and_preserves_path_chaining() {
    let mut actor = walker(NpcWanderAxis::Any);
    actor.walk_counter = 1;
    actor.step_direction = Some(Direction::Right);
    actor.scripted_path.extend([(6, 5), (6, 6)]);
    let mut hooks = Decisions::default();
    pass(core::slice::from_mut(&mut actor), &mut hooks);
    assert_eq!(
        hooks.events,
        vec![Event::Finished(0, Direction::Right, true, 6, 5)]
    );
    assert_eq!(actor.walk_counter, 16);
    assert_eq!(actor.step_direction, Some(Direction::Down));
    assert_eq!(actor.delay_counter, 0);
}

#[test]
fn hidden_delayed_and_active_actors_do_not_request_new_decisions() {
    let mut actors: Vec<_> = (0..4).map(|_| walker(NpcWanderAxis::Any)).collect();
    actors[0].visible = false;
    actors[1].delay_counter = 1;
    actors[2].walk_counter = 3;
    actors[2].step_direction = Some(Direction::Right);
    actors[3].movement_type = NpcMovementType::Stationary;
    let mut hooks = Decisions::default();
    pass(&mut actors, &mut hooks);
    assert_eq!(hooks.events, vec![Event::Stationary(3)]);
    assert_eq!(actors[1].delay_counter, 0);
    assert_eq!(actors[2].walk_counter, 2);
    assert_eq!(actors[3].facing, Direction::Up);
}

#[test]
fn occupied_destinations_do_not_consume_game_owned_acceptance_state() {
    let mut actors = vec![walker(NpcWanderAxis::Any), walker(NpcWanderAxis::Any)];
    actors[1].y = 6;
    actors[1].movement_type = NpcMovementType::Stationary;
    let mut hooks = Decisions::default();
    pass(&mut actors, &mut hooks);
    assert_eq!(
        hooks.events,
        vec![Event::Choose(0), Event::Blocked(0), Event::Stationary(1)]
    );
    assert_eq!(actors[0].walk_counter, 0);
    assert_eq!(actors[0].delay_counter, 19);
}
