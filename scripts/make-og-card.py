#!/usr/bin/env python3
"""
Build public/og-card.jpg — the social / link-preview card.

Why this exists: iMessage, Slack, WhatsApp and the rest read `og:image` and
render it as a BANNER at roughly 1.91:1. The only brand image we had was
public/full-logo.jpg, which is 1518x1412 — near-square. Fed to a large-card
renderer, a square image is either letterboxed into a small thumbnail or
centre-cropped so the wordmark loses its ends. That is why a texted
sirreel.com link never looked like the old Wix one.

This crops the wordmark out of full-logo.jpg (which is mostly black padding),
scales it, and centres it on a 1200x630 black canvas — the size every
platform documents.

Re-run after any logo change:
    python3 scripts/make-og-card.py
"""
from PIL import Image

SRC = 'public/full-logo.jpg'
OUT = 'public/og-card.jpg'
W, H = 1200, 630
# Share of the card width the wordmark occupies. 0.66 leaves enough margin
# that platforms which crop a few percent off the edges (and iMessage's
# rounded corners) never touch the letterforms.
LOGO_WIDTH_RATIO = 0.66

src = Image.open(SRC).convert('RGB')

# The source is a white wordmark on black with heavy padding. Threshold to
# find the ink, then crop to its bounding box.
ink = src.convert('L').point(lambda p: 255 if p > 40 else 0)
box = ink.getbbox()
if box is None:
    raise SystemExit(f'{SRC}: found no non-black pixels to crop')
logo = src.crop(box)

target_w = int(W * LOGO_WIDTH_RATIO)
target_h = max(1, round(logo.height * target_w / logo.width))
if target_h > H * 0.62:                      # tall lockups: fit by height instead
    target_h = int(H * 0.62)
    target_w = max(1, round(logo.width * target_h / logo.height))
logo = logo.resize((target_w, target_h), Image.LANCZOS)

card = Image.new('RGB', (W, H), (0, 0, 0))
card.paste(logo, ((W - target_w) // 2, (H - target_h) // 2))
card.save(OUT, 'JPEG', quality=92, optimize=True, progressive=True)
print(f'{OUT}: {W}x{H}, logo {target_w}x{target_h}')
