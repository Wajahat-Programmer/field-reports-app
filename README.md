# Field reports: React Native app

An Android app for filing photo reports from a place with a bad connection. A report is a short description and
one to five photos. The point of the app is the delivery path: a saved report reaches the server exactly once, even
if the phone goes offline, the connection drops mid-upload, or the app is killed.

- React Native 0.88 (bare CLI, not Expo), TypeScript, Android. iOS was not built or tried.
- The server is in a separate repo: [field-reports-backend](https://github.com/Wajahat-Programmer/field-reports-backend).
- 101 tests, run with `npm test`.

## Try it without building

The quickest way to see it: install the prebuilt APK from the
[latest release](https://github.com/Wajahat-Programmer/field-reports-app/releases/latest), or from
[this Drive folder](https://drive.google.com/drive/folders/19rCShvgFH8raEXE1QnbQgdWu7YVSX2Wg). Both also have a
2.5 minute screen recording of the main scenario. The phone needs Android 7 or newer.

```bash
adb install -r field-reports.apk     # or copy it to the phone and open it
```

It talks to my demo server, so it works with no setup. You can try airplane mode, force-quit and a slow connection
straight away. To make the *server* fail on purpose you need your own backend, which is the next two sections.

## Run it from source

You need:

- Node 22.11 or newer.
- A JDK, 17 or newer (built with 20).
- The Android SDK, with the `ANDROID_HOME` environment variable pointing at it (or `sdk.dir=...` in
  `android/local.properties`).
- An emulator, or a phone with USB debugging.

**On Windows, clone to a short path such as `C:\src`.** The native Android build fails on paths longer than 260
characters.

1. Install and create your config file. Without the config file, the typecheck and the build stop with
   "Cannot find module './config.local'" (the tests do not need it).

   ```bash
   npm ci
   cp src/config.local.example.ts src/config.local.ts        # PowerShell: Copy-Item src\config.local.example.ts src\config.local.ts
   ```

   Then edit `src/config.local.ts`. It is git-ignored because the key is in it. The key must be the one the backend
   was started with.

   ```ts
   export default { baseUrl: 'https://your-server.example.com', apiKey: 'the-backend-API_KEY' };
   ```

2. Start a backend (next section), or point `baseUrl` at one that is already running.

3. Run the app, in one of two ways.

   Debug build with hot reload, using two terminals:

   ```bash
   npx react-native start
   npx react-native run-android
   ```

   A debug build loads its JavaScript from Metro, so it cannot reopen on its own once the dev server is gone, for
   example in airplane mode after a force-quit. For anything that should survive that, build the release APK, which
   carries its own bundle:

   ```bash
   cd android
   ./gradlew assembleRelease          # Windows: gradlew.bat assembleRelease
   adb install -r app/build/outputs/apk/release/app-release.apk     # signed with the debug key, fine for a demo
   ```

### Pointing the app at a backend on your own machine

- **Emulator:** run the backend on port 3000 and set `baseUrl` to `http://10.0.2.2:3000`.
- **Phone on USB:** run `adb reverse tcp:3000 tcp:3000` and set `baseUrl` to `http://localhost:3000`.

Plain http only works in debug builds. A release build needs https.

## Standing up the backend

The backend README has the full steps, including the systemd unit and Caddyfile used for the live copy. To run one
locally, which is all the app needs:

```bash
git clone https://github.com/Wajahat-Programmer/field-reports-backend && cd field-reports-backend
npm ci
API_KEY=choose-a-secret npm start      # PowerShell: $env:API_KEY = "choose-a-secret"; npm start
```

Use the same `choose-a-secret` as `apiKey` in the app's config. Check it is up with
`curl http://127.0.0.1:3000/health`, which answers `{"ok":true}`.

The live copy runs on an Oracle Cloud Always Free VM behind Caddy.

## Making it fail

Most of this is done on the emulator from a terminal. Android Studio's emulator controls work too.

| What to do | How |
|---|---|
| Airplane mode on or off | `adb shell cmd connectivity airplane-mode enable` / `disable` |
| Force-quit | `adb shell am force-stop com.fieldreports`, then open the app again |
| Slow link | `adb emu network speed 800:800` and `adb emu network delay 150` (`speed full` and `delay none` undo it) |
| Server errors, a lost reply, a hang, a dropped upload | the backend's `/admin/faults` endpoint; examples are in its README |
| A sixth photo, zero photos, a blank description | the Save button stays disabled and says what is missing |
| Refuse the camera, then grant it later | deny the prompt twice, tap Open Settings, allow it, come back; no restart needed |
| Start over | the button at the bottom of the home screen |

Two things about the emulator's slow link: it is a rough stand-in, and its speed was erratic in my runs (one profile
gave about 20 KB/s, a nominally faster one about 4 KB/s), so judge the app by whether reports arrive, not by the speed.

## How it works

```
src/core      plain TypeScript, no React Native imports; this is where delivery lives
src/native    thin adapters for the phone: storage, network state, photos, camera permission, uploads
src/app       hooks and the one-glance status wording
src/screens   home and compose
```

The upload logic never touches a screen. `UploadRunner` takes a store, a transport and a network monitor, so the
tests run it against in-memory fakes, and a second suite runs it against the real backend.

### Why a report is not lost

1. **Save first.** Saving a report writes it to the phone, with a UUID made on the phone, before anything touches
   the network. The UUID is also the server's idempotency key.
2. **One state machine per report:** `queued`, `uploading`, `uploaded`, `failed`. Every change is written to storage
   as it happens. Each photo that the server has confirmed is recorded too.
3. **After a kill,** the runner starts, finds anything left `uploading`, and queues it again. Nothing is held in memory only.
4. **The photos live in the app's private files folder,** not the cache, which Android may clear while a report waits.

### Why a report lands once

Every server call can be repeated safely, so the app never has to guess whether an earlier attempt got through.
Creating a report with a known id does nothing the second time. The server appends only the bytes it does not already
hold. Completing twice is harmless. In tests, a reply that is lost after the server committed leaves exactly one
report.

### What happens on a bad connection

- **Chunks.** A photo goes up in 64 KB pieces. Before sending, the app asks the server how many bytes it has and
  continues from there. Progress on screen is bytes the server confirmed, not bytes the phone handed to its network
  stack. A dropped connection costs at most one chunk, and a killed app resumes the photo where it stopped.
- **What counts as retryable.** Network errors, timeouts, 404, 408, 429 and 5xx (a 502 from the proxy is how a lost
  reply looks) are retried. Other 4xx answers are final: the report becomes `failed`, stays on the phone, and shows a
  Try again button. A 401 or 403 pauses the whole queue without dropping the report.
- **Backoff.** 1 second doubling to 5 minutes, with jitter. It starts over when the network returns or the app comes
  to the foreground, so an old outage does not leave the wait at its ceiling.
- **A dropped network cancels the request in flight** straight away, instead of waiting for a timeout on a socket that
  is already dead. The report goes back in the queue without counting as a failure.
- **A stall watchdog.** A request that is confirmed by nothing for 45 seconds is aborted, so one hung request cannot
  block the queue. It is reset by each confirmed chunk.
- **One report at a time, oldest first,** and one runner at a time.

### Photos

A photo is re-encoded as a JPEG no larger than 2048 pixels on its long side, starting at quality 82 and stepping
down until it is under 4 MB, well below the 5 MB cap. A 21 MB camera-sized original came out at about 1.3 MB and is
still a clear picture. A photo that cannot be brought under the limit is rejected with a message, and every
intermediate file is deleted. Photos are prepared one after another in the background; the screen shows a spinner on
each slot and stays usable.

The gallery uses Android's system photo picker, which needs no permission. The camera does: the app asks, explains a
refusal, offers to ask again, and when Android will no longer show the prompt it sends you to Settings and notices
the change when you come back.

### The screens

The home screen answers "is my work safe?" in one banner, and keeps two facts apart: a report **saved on this
phone** (not on the server yet) and one **delivered** (the server confirmed it). The two words never appear in one
sentence. Each waiting report says where it stands: uploading with a progress bar, waiting for a connection, trying
again in N seconds, or rejected with the reason. The "Delivered" list is fetched from the server, not read back from
the phone, and the last list stays on screen when offline, even after a restart. Until the saved reports have loaded,
the banner says so, and does not claim "nothing waiting".

### Drafts

A report you are still writing is not lost if the app is killed. The description and the photos picked so far are kept
as a draft while you type, and pressing Back keeps it too. The home screen then shows an "Unsaved draft" card that
says it is not waiting to upload, with Continue and Discard. A photo that was still being prepared at the moment of
the kill is the one thing lost. Photos that belong to no saved report and no draft are deleted when the app starts.

### Uploading in the background

While any report is waiting, a small foreground service holds a notification ("Uploading 2 reports", or "2 reports
saved, waiting for a connection" when offline, since it must not claim to be uploading then). It keeps Android from
freezing or killing the app, and it runs a headless JavaScript task, because React Native stops its timers when the
app leaves the screen and the upload runner depends on timers for its stall watchdog and retry delays. The service
stops itself when nothing is waiting. The notification permission is asked once, after the first save; refusing it
only hides the notification.

### Start over

It deletes every report that has not been delivered, with its photos and any leftover upload files, cancels an upload
in flight first, and leaves delivered reports on the server. The dialog says exactly how many reports it will delete.
I kept it local on purpose: with no login, a server-side wipe from a phone would delete other people's data.

## Decisions, and why

- **Chunked uploads instead of one request per photo.** My first version sent each photo in one request. On a slow
  link the phone reported the upload as "sent" almost at once, then waited a long time for the data to drain, and the
  stall watchdog aborted it and restarted the photo from zero every time. A real 2G link would have failed nearly
  every upload. Chunks make progress honest and make a drop cheap.
- **AsyncStorage, one key per report.** A write only touches that report, so a half-finished write cannot damage the
  others. It is enough at this size.
- **Online means "has a connection".** NetInfo's "internet reachable" probe can fail on networks that still reach the
  server, and a wrong "offline" would stop uploads for good. A bad link just fails requests and backs off.
- **One connection pool with a 25 second timeout.** After a network drop, a pooled connection can be dead while still
  looking alive. Sending everything through one library with a short timeout made recovery after a drop about 58
  seconds instead of 264. Forcing a new connection for every request was faster to recover but made throughput far
  worse on a slow link, so I dropped it.
- **A foreground service with a headless task, not WorkManager.** The runner already lives in the app's JavaScript, so
  the simplest thing that keeps it running is to keep the process alive. I first tried the service alone and an upload
  still stalled in the background, which is how I found that React Native pauses its timers; the headless task fixed it.
- **No navigation library.** Two screens do not need one.
- **A release build as the thing to run.** Force-quit and airplane mode are central to how the app is used, and a debug build
  cannot restart without its dev server.

## What was tested

- **101 automated tests.** Unit tests for the runner (offline then online, a simulated kill, a lost reply, 5xx versus
  4xx, a hung request, airplane mode in the middle, a rejected key, a server wipe, reset, backoff), the transport,
  the image pipeline, validation, storage, drafts, the notification wording and the status wording. Plus 9 that run the real runner against the real backend
  with its fault switches. I broke the code on purpose several times and checked that the right test failed.
- **On an emulator (Pixel 6, Android 14, release build):** three reports composed offline (5, 1 and 2 photos), force-quit
  and reopened, then delivered over a slow link with the connection cut at two points; every report arrived exactly
  once with every photo intact and under 5 MB. Also checked: camera capture, refusing and then granting the camera,
  the gallery picker with a 21 MB original, Start over, and the delivered list while offline. A draft survived a
  force-quit while composing. A report saved and then sent to the background was delivered with the app off screen the
  whole time, with the connection cut in the middle, and the foreground service stopped by itself afterwards.
- **Bugs this found and I fixed:** a dropped connection turning into a permanent failure, an image whose last byte
  arrived but was never registered, the delivered list vanishing offline, a "nothing waiting" flash at start-up, and a
  retry delay that stayed at its maximum after a long outage.

## Not done, or not checked

- **No real phone.** Everything above ran on an emulator. Camera capture, true airplane mode and OEM battery
  behaviour on a physical device are unchecked.
- **Background uploads are a best effort.** The service starts while the app is on screen (Android 12 and later refuse
  to start one from the background), so work that arrives while the app is already in the background waits until it is
  opened. If the person swipes the app away, uploads stop and resume the next time it is opened. Only checked on an
  emulator; phone makers' battery managers may still be stricter.
- **Retries never end for unexpected errors.** A bug in my own code looks like a network error and would be retried
  forever instead of failing loudly.
- **Accessibility** is labels and 48 dp targets, with no screen reader pass.
- The API key is inside the app, which is fine for a demo with no login and not for production.
- The release APK is signed with the debug key.
- iOS was not touched.

## Next steps

Move background work to WorkManager so it survives the app being swiped away; test on a real phone and record the
final scenario there; add an end-to-end test that drives the real app on an emulator; make
the chunk size adapt to the link; show a per-photo thumbnail in the upload progress; and give each install its own
credential in place of the shared key.
