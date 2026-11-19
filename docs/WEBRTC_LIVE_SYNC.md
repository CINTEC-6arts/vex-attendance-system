# Browser-only WebRTC live sync

This implementation uses a one-laptop-to-many-devices star. The Windows
laptop or other selected browser acts as the live-sync host. Phones and
Windows clients join it over local WebRTC data channels.

The existing QR snapshot format remains the fallback.

## Pairing

1. Open **Sync attendance** on every device.
2. On the host, press **Host live sync**.
3. A device points its camera at the host QR code.
4. The host QR contains an offer and a session identifier.
5. The joining device presses **Join live sync**, scans the host QR, and displays
   an answer QR.
6. The host scans the answer QR.

Repeat the pairing sequence once for each joining device. The host does not
need to create a peer connection to a phone before the phone is on the same
local network or hotspot.

## Signaling payloads

Offer:

```json
{
  "t": "webrtc-offer",
  "v": 1,
  "e": "event-id",
  "h": "data.csv fingerprint",
  "session": "random-session-id",
  "sdp": {}
}
```

Answer:

```json
{
  "t": "webrtc-answer",
  "v": 1,
  "e": "event-id",
  "h": "data.csv fingerprint",
  "session": "random-session-id",
  "sdp": {}
}
```

The QR payload prefixes identify each message:

- `vex-offer:`
- `vex-answer:`

SDP candidates are included after ICE gathering completes, so no STUN or
TURN service is required on a private hotspot or LAN.

## Attendance messages

Connected data channels use the existing packed `SyncPayload` format, prefixed
with `vex-sync:`:

```text
vex-sync:<existing JSON snapshot>
```

Local attendance changes are queued and sent as complete snapshots. Snapshots
use the existing event ID and `data.csv` hash validation. Incoming live
snapshots pass through the existing conflict-review flow.

The host currently receives client snapshots and broadcasts its local snapshot
to open peer channels. A client does not directly broadcast to other clients.

## Offline behavior

An active hotspot or LAN route is still required for WebRTC traffic. If the
network disappears:

- Browser state remains in `localStorage`.
- `data` channels enter disconnected/failed states.
- Existing QR snapshot sync remains available.
- A peer can be paired again with a fresh offer/answer exchange.

This implementation is browser-only and does not require a public server.
