export async function onEnter() {
    console.log("Welcome to the demo map!");
    console.log("Use arrow keys to move the player character.");
    console.log("Press Escape to quit.");
    return { type: "done" };
}

export async function onStep(x, y) {
    const tileX = Math.floor(x / 8);
    const tileY = Math.floor(y / 8);

    if (tileX >= 1 && tileX <= 3 && tileY >= 1 && tileY <= 3) {
        console.log("You stepped into the pond!");
    }
    if (tileX >= 12 && tileX <= 14 && tileY >= 8 && tileY <= 10) {
        console.log("You stepped into the south pond!");
    }
    return { type: "continue" };
}

export async function onInteract(facingX, facingY) {
    console.log(`Interacted at (${facingX}, ${facingY})`);
    return { type: "done" };
}
