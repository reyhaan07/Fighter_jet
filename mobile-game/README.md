# Strike Wing for Android

This folder turns the same game (the code in `../src`) into an Android app with
[Capacitor](https://capacitorjs.com). Nothing is duplicated: phone controls and
phone graphics settings live in the shared game code and switch on automatically
on touch screens.

## Install on your phone

1. On your Android phone, open
   **https://github.com/reyhaan07/Fighter_jet/releases/latest**
2. Tap **StrikeWing.apk** to download it.
3. Open the downloaded file. If Android asks, allow your browser to
   **install unknown apps**, then tap **Install**.
4. Open **Strike Wing** from your home screen. Hold the phone sideways.

New versions install over the old one and keep your progress (credits, jets,
unlocked levels).

## Controls

| Control | How |
|---|---|
| Fly | Drag anywhere on the left half: up climbs, down dives, sideways rolls (auto-level keeps the wings level when you let go) |
| Throttle | Slider on the left edge; slide into the orange **AB** zone at the top for afterburner |
| Gun | Hold **GUN** (red) |
| Selected weapon | Tap the blue button (missiles lock on by themselves) |
| Next weapon / flares / defence / next target | **WPN** / **FLR** / **DEF** / **TGT** |
| Camera, wingmen, pause | **CAM**, **WING**, **II** (or the phone's Back button) |

A Bluetooth game controller also works. Settings → Controls has an
*Invert pitch* option if you prefer a real-stick feel (drag down to climb).

## Graphics on phones

The game picks **Medium** on recent flagship phones and **Low** on others, and
lowers the resolution automatically if the frame rate drops. You can change it
under Settings → Graphics.

## How the APK is built

Every push that changes the game runs `.github/workflows/android-apk.yml` on
GitHub: it builds the web game, copies it into the Android project, builds a
signed release APK and publishes it as the **android-latest** release.

To build it yourself you need Node 22, JDK 21 and the Android SDK (Android
Studio installs it):

```bash
npm install                    # in the repo root
cd mobile-game
npm install
npm run apk                    # → android/app/build/outputs/apk/release/app-release.apk
```

`npm run build` only refreshes the game inside the Android project, so you can
open `android/` in Android Studio and press Run.

The app is signed with `android/strikewing.keystore` (password `strikewing`),
kept in the repo so every build can update the previous install. For a
Google Play release, create your own private key and keep it out of the repo.
