use dotzuki_renderer::{FrameBuffer, RenderConfig, Rgba};
use dotzuki_renderer::battle_transition::{BattleTransitionKind, BattleTransitionState};
fn main() {
    let mut source = FrameBuffer::new(RenderConfig::new(160,144), Rgba::WHITE);
    for y in 0..144 { for x in 0..160 {
        let shade = if x%8 == 0 || y%8 == 0 { 85 } else { 170 };
        source.set_pixel(x,y,Rgba::new(shade,shade,shade,255));
    }}
    let mut state = BattleTransitionState::new(BattleTransitionKind::Spiral {outward:true},20,18);
    let out = std::env::args().nth(1).unwrap();
    for frame in 1..=120 {
        state.tick();
        if [1,12,60,120].contains(&frame) {
            let mut dest = FrameBuffer::new(RenderConfig::new(160,144),Rgba::WHITE);
            state.render(&source,&mut dest);
            let mut bytes=b"P6\n160 144\n255\n".to_vec();
            for y in 0..144 { for x in 0..160 {
                let color=dest.get_pixel(x,y).unwrap(); bytes.extend([color.r,color.g,color.b]);
            }}
            std::fs::write(format!("{out}-{frame:03}.ppm"),bytes).unwrap();
            println!("frame={frame} done={}",state.is_done());
        }
    }
}
