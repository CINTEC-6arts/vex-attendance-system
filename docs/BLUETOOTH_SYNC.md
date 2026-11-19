# Bluetooth sync protocol

The browser implementation expects a BLE GATT peripheral named with the prefix
`VEX Attendance`. The peripheral acts as the hub for one or more browser
clients.

## GATT service

- Service: `f3f8b100-5a1f-4c3e-a3b8-2fd1a1b7c001`
- Snapshot characteristic: `f3f8b101-5a1f-4c3e-a3b8-2fd1a1b7c001`
- Update/notification characteristic: `f3f8b102-5a1f-4c3e-a3b8-2fd1a1b7c001`

The snapshot characteristic must support read. The update characteristic must
support write and notifications.

## Payload

All characteristics use UTF-8 JSON containing the existing QR `SyncPayload`
format:

```json
{
  "v": 2,
  "e": "event-2",
  "h": "<data.csv SHA-256>",
  "s": "<base64url packed attendance>"
}
```

The browser writes its full attendance snapshot whenever a local status changes.
The hub merges it using the existing QR conflict rules and then writes/does a
notification containing the merged snapshot. A notification with the snapshot
is passed through the existing `applySyncPayload()` function.

## Hub behavior

1. Advertise the service and the `VEX Attendance` name prefix.
2. Provide an event-specific snapshot for the selected event.
3. Accept snapshots written by clients.
4. Validate the event ID and dataset hash.
5. Merge the snapshot with the hub snapshot.
6. Notify every connected client with the merged snapshot.

The hub should persist the latest merged snapshot. It may also retain an
operation log, but the browser implementation initially exchanges complete
packed snapshots. Snapshot payload size remains small because each attendance
status uses two bits.

## Browser behavior

`script.ts`:

- Requests the hub through Web Bluetooth.
- Reads the initial snapshot.
- Subscribes to update notifications.
- Writes the local snapshot after attendance changes.
- Queues the latest snapshot in `localStorage` while disconnected.
- Rewrites the queued or current snapshot after reconnecting.

Web Bluetooth is available in Chromium browsers. It is not supported by Safari
on iOS or iPadOS.
