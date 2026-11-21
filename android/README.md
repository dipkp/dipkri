# dipkri Android app

Step 1 of the mobile plan: a WebView shell that loads the same web app, plus the
bridge the web build already looks for (`window.dipkriDesktop`). The local
torrent service (libtorrent4j + ExoPlayer) plugs in behind `getSidecar()` next.

```
android/
├── settings.gradle.kts
├── build.gradle.kts
├── gradle.properties
└── app/
    ├── build.gradle.kts
    └── src/main/
        ├── AndroidManifest.xml
        ├── java/org/dipkri/app/MainActivity.kt
        └── res/values/{strings,themes}.xml
```

## One-time toolchain

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-android.ps1
```

Installs JDK 17, Android cmdline-tools, platform-tools, platforms;android-34 and
build-tools;34.0.0 under `C:\Users\<you>\android-tools`, then Gradle 8.7.
Nothing is installed system-wide and no admin rights are needed.

Check the network first: the full download is ~1.5 GB. On a 60 KB/s line that is
several hours; run it overnight and check the log it writes.

## Build

```powershell
cd android
..\android-tools\gradle\bin\gradle.bat assembleDebug
```

APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`.

## Install on a phone

```powershell
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

Play Store does not accept torrent clients, so the release APK is served
directly from the site. A release build needs a keystore:

```powershell
keytool -genkeypair -v -keystore dipkri-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias dipkri
```

## Roadmap

| Step | Work |
|---|---|
| 1 (this) | WebView shell, bridge, sign-in, browsing |
| 2 | `TorrentService`: foreground service, local HTTP server on 127.0.0.1:17891, `/stream` with Range, `/health`, `/room-end` |
| 3 | libtorrent4j engine behind that server (TCP/UDP swarm, no WebRTC limits) |
| 4 | ExoPlayer points at the local URL; room end wipes the cache directory |
| 5 | Release signing, APK download page on dipkri.duckdns.org |
