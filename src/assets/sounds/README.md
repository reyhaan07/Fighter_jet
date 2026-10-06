# Real sound recordings (optional)

Drop audio files here to replace the game's built-in (pre-rendered) sounds.
They are bundled into the build, so the game stays fully offline.

File names (any of `.ogg`, `.mp3`, `.wav`):

| File name | Used for | Tip |
|---|---|---|
| `engine` | Your jet's engine (looped, pitch follows throttle) | a seamless jet-engine loop, 2–10 s |
| `afterburner` | Afterburner roar (looped, fades in with Shift) | low rumbling loop |
| `gun20` | 20 mm rotary cannon (looped while firing) | a seamless "brrrt" loop |
| `gun30` | 30 mm cannon, one shot | |
| `gunEnemy` | Enemy cannon shot | |
| `aa` | Anti-aircraft gun shot | |
| `explosionSmall` / `explosionMedium` / `explosionLarge` | Explosions by size | |
| `missile` / `missileHeavy` | Missile launch (normal / big) | |
| `rocket` | Rocket pod launch | |
| `flyby` | A jet passing close by | |

Good free sources: freesound.org (filter by the CC0 licence), sonniss.com
(free GDC game-audio bundles), kenney.nl. Check each file's licence.

After adding files run `npm run build` (the desktop shortcut rebuilds automatically).
