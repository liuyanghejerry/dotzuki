#!/usr/bin/env python3
"""Generate pixel art app icon -- trainer sprite in classic Game Boy JRPG style."""
from PIL import Image, ImageDraw

SIZE = 32
SCALE = 16  # 32x32 -> 512x512

# Palette
C = {
    't': (0, 0, 0, 0),       # transparent
    'o': (40, 40, 40),        # outline
    'r': (200, 48, 48),       # cap red
    's': (232, 180, 160),     # skin
    'h': (80, 56, 48),        # hair
    'w': (248, 248, 248),     # white (shirt)
    'b': (56, 56, 192),       # blue (pants)
    'u': (72, 56, 40),        # brown (shoes/bag)
    'g': (180, 180, 180),     # gray
    'p': (220, 80, 80),       # ball red
    'd': (32, 32, 32),        # dark fill
}

def set(px, x, y, color):
    if 0 <= x < SIZE and 0 <= y < SIZE:
        px[x, y] = C[color]

def fill_rect(px, x1, y1, x2, y2, color):
    for y in range(y1, y2 + 1):
        for x in range(x1, x2 + 1):
            set(px, x, y, color)

def draw_cap(px):
    """Red trainer cap."""
    # Cap bill (visor)
    fill_rect(px, 6, 3, 25, 4, 'o')
    fill_rect(px, 7, 5, 24, 6, 'r')
    # Cap dome
    fill_rect(px, 9, 4, 22, 4, 'r')
    fill_rect(px, 10, 5, 21, 5, 'r')
    fill_rect(px, 8, 7, 23, 7, 'r')
    fill_rect(px, 9, 8, 22, 8, 'r')
    # Black rim
    fill_rect(px, 8, 6, 23, 6, 'o')

def draw_head(px):
    """Face / skin area."""
    # Skin circle-ish area
    fill_rect(px, 10, 8, 21, 8, 's')
    fill_rect(px, 9, 9, 22, 9, 's')
    fill_rect(px, 9, 10, 22, 10, 's')
    fill_rect(px, 9, 11, 22, 11, 's')
    fill_rect(px, 9, 12, 22, 12, 's')
    fill_rect(px, 9, 13, 22, 13, 's')
    fill_rect(px, 10, 14, 21, 14, 's')
    fill_rect(px, 11, 15, 20, 15, 's')
    # Eyes
    set(px, 12, 10, 'o')
    set(px, 13, 10, 'o')
    set(px, 19, 10, 'o')
    set(px, 18, 10, 'o')

def draw_body(px):
    """White shirt + blue pants."""
    # Shirt (white)
    fill_rect(px, 8, 15, 23, 15, 'w')
    fill_rect(px, 7, 16, 24, 16, 'w')
    fill_rect(px, 7, 17, 24, 17, 'w')
    fill_rect(px, 8, 18, 23, 18, 'w')
    fill_rect(px, 9, 19, 22, 19, 'w')
    # Pants (blue)
    fill_rect(px, 8, 20, 23, 20, 'b')
    fill_rect(px, 7, 21, 24, 21, 'b')
    fill_rect(px, 7, 22, 24, 22, 'b')
    fill_rect(px, 8, 23, 23, 23, 'b')
    # Legs
    fill_rect(px, 9, 24, 14, 25, 'b')
    fill_rect(px, 17, 24, 22, 25, 'b')
    # Shoes (brown)
    fill_rect(px, 9, 26, 14, 27, 'u')
    fill_rect(px, 17, 26, 22, 27, 'u')

def draw_ball(px):
    """Small ball in hand."""
    # Ball at the right side (around x=25, y=18-23)
    fill_rect(px, 25, 18, 28, 18, 'p')  # top red half
    fill_rect(px, 25, 19, 28, 19, 'p')
    fill_rect(px, 25, 20, 28, 20, 'o')  # center band
    fill_rect(px, 25, 21, 28, 21, 'w')  # bottom white half
    fill_rect(px, 25, 22, 28, 22, 'w')
    # Center button
    set(px, 26, 20, 'w')
    set(px, 27, 20, 'w')
    set(px, 26, 19, 'w')
    set(px, 27, 19, 'w')

def draw_backpack(px):
    """Backpack on the back."""
    fill_rect(px, 4, 16, 6, 16, 'u')
    fill_rect(px, 4, 17, 6, 17, 'u')
    fill_rect(px, 4, 18, 6, 18, 'u')
    fill_rect(px, 5, 19, 6, 19, 'u')
    # Strap
    set(px, 7, 16, 'o')
    set(px, 7, 17, 'o')

def draw_outline(px):
    """Apply outline around the character."""
    # Head outline
    fill_rect(px, 8, 7, 8, 14, 'o')
    fill_rect(px, 23, 7, 23, 14, 'o')
    fill_rect(px, 9, 7, 22, 7, 'o')
    fill_rect(px, 9, 15, 22, 15, 'o')
    # Body outline
    fill_rect(px, 7, 15, 7, 22, 'o')
    fill_rect(px, 24, 15, 24, 22, 'o')
    # Bottom outline
    fill_rect(px, 8, 23, 23, 23, 'o')
    fill_rect(px, 8, 23, 8, 24, 'o')
    fill_rect(px, 23, 23, 23, 24, 'o')

def draw_arm(px):
    """Left arm holding a ball up."""
    fill_rect(px, 24, 15, 25, 15, 's')
    fill_rect(px, 25, 16, 26, 16, 's')
    fill_rect(px, 26, 17, 27, 17, 's')

# Build image
img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
px = img.load()

# Draw in layers
draw_cap(px)
draw_head(px)
draw_body(px)
draw_ball(px)
draw_backpack(px)
draw_arm(px)
draw_outline(px)

# Scale with nearest-neighbor
img_scaled = img.resize((SIZE * SCALE, SIZE * SCALE), Image.NEAREST)
img_scaled.save("icon.png")
print(f"Saved icon.png  ({SIZE*SCALE}x{SIZE*SCALE})")

img.save("icon_32.png")
print("Saved icon_32.png (source)")
