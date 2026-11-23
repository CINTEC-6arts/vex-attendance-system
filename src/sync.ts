import * as QRCode from "qrcode";
import jsQR from "jsqr";
import * as core from "./core";
import * as app from "./app";

let syncStream: MediaStream | null = null;
let scanLoopActive = false;
let liveScanLoopActive = false;
let liveScanRunner: (() => void) | null = null;
let lastScannedPayload = "";
let lastScannedAt = 0;
let lockedSyncOrientation: OrientationLockType | null = null;
enum LiveSyncRole {
    HOST = "host",
    CLIENT = "client",
}
let liveRole: LiveSyncRole | null = null;
let liveInitialSnapshotPending = false;
let guestAwaitingConflictResolution = false;
let liveKeepAliveTimer: number | null = null;
let clientPeer: RTCPeerConnection | null = null;
let clientChannel: RTCDataChannel | null = null;
const hostPeers = new Map<string, RTCPeerConnection>();
const hostChannels = new Map<string, RTCDataChannel>();
const acceptedHostAnswers = new Set<string>();
const discrepancies = new Map<string, { name: string; local: core.AttendanceStatus; incoming: core.AttendanceStatus }>();
const pendingSyncChoices = new Map<string, { record: core.RecordEntry; incoming: core.AttendanceStatus }>();

function stopSyncCamera(): void {
    scanLoopActive = false;
    liveScanLoopActive = false;
    syncStream?.getTracks().forEach((track) => track.stop());
    syncStream = null;
    core.syncVideo.srcObject = null;
    core.liveSyncVideo.srcObject = null;
}

async function lockSyncOrientation(): Promise<void> {
    const orientation = screen.orientation;
    if (!orientation?.lock) return;
    const lockType: OrientationLockType = orientation.type.startsWith("landscape") ? "landscape" : "portrait";
    try {
        await orientation.lock(lockType);
        lockedSyncOrientation = lockType;
    } catch (orientationError) {
        console.warn("Screen orientation could not be locked for QR sync.", orientationError);
    }
}

function unlockSyncOrientation(): void {
    if (!lockedSyncOrientation) return;
    screen.orientation.unlock();
    lockedSyncOrientation = null;
}

async function startSyncCamera(
    deviceId?: string,
    video: HTMLVideoElement = core.syncVideo,
    select: HTMLSelectElement = core.cameraSelect,
    selectWrap: HTMLElement = core.cameraSelectWrap,
    live: boolean = false,
): Promise<void> {
    stopSyncCamera();
    syncStream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } },
    });
    video.srcObject = syncStream;
    await video.play();
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
    const selectedId = syncStream.getVideoTracks()[0]?.getSettings().deviceId || deviceId || "";
    select.replaceChildren(...devices.map((device, index) => {
        const option = new Option(device.label || `Camera ${index + 1}`, device.deviceId);
        option.selected = device.deviceId === selectedId;
        return option;
    }));
    selectWrap.hidden = devices.length < 2;
    if (live) liveScanLoopActive = true;
    else scanLoopActive = true;
}

function closeSyncDialog(): void {
    stopSyncCamera();
    unlockSyncOrientation();
    core.syncDialog.close();
}

function closeLiveSyncDialog(): void {
    disconnectLiveSync();
    unlockSyncOrientation();
    core.liveSyncDialog.close();
}

function disconnectLiveSync(): void {
    clientPeer?.close();
    clientPeer = null;
    clientChannel = null;
    hostPeers.forEach((peer) => peer.close());
    hostPeers.clear();
    hostChannels.clear();
    acceptedHostAnswers.clear();
    liveRole = null;
    liveInitialSnapshotPending = false;
    guestAwaitingConflictResolution = false;
    setLiveSyncIndicator(false, "Live sync inactive");
    setLiveSyncStatus("Live sync is disconnected");
    core.liveSyncCanvas.hidden = true;
    core.liveRoleInstructions.hidden = true;
    core.liveQrPanel.hidden = true;
    core.liveScannerPanel.hidden = true;
    core.liveSyncVideo.hidden = true;
    core.regenerateLiveQrButton.hidden = true;
    core.liveSyncMessage.textContent = "Choose whether this device is hosting or joining.";
    core.disconnectWebRTCButton.disabled = true;
    core.hostWebRTCButton.disabled = false;
    core.joinWebRTCButton.disabled = false;
}

function backToSyncMethods(fromQr: boolean): void {
    stopSyncCamera();
    unlockSyncOrientation();
    if (fromQr) core.syncDialog.close();
    else core.liveSyncDialog.close();
    core.syncMethodDialog.showModal();
}

async function createSyncPayload(): Promise<string> {
    if (!core.state.eventId || !core.state.records.length) throw new Error("Select an event before syncing.");
    const bytes = new Uint8Array(Math.ceil(core.state.records.length / 4));
    core.state.records.forEach((record, index) => {
        const statusCode = core.statusCodes[core.getAttendanceStatus(record)];
        bytes[Math.floor(index / 4)] |= statusCode << ((index % 4) * 2);
    });
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    const packedStatuses = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const payload: core.SyncPayload = {
        v: 2,
        e: core.state.eventId,
        h: await core.getDatasetHash(),
        s: packedStatuses,
    };
    return JSON.stringify(payload);
}

function decodePackedStatuses(value: string): Array<[number, core.AttendanceStatus]> {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const requiredBytes = Math.ceil(core.state.records.length / 4);
    if (binary.length < requiredBytes) throw new Error("This QR code does not contain all attendance statuses.");
    const statuses: Array<[number, core.AttendanceStatus]> = [];
    core.state.records.forEach((_, index) => {
        const statusCode = binary.charCodeAt(Math.floor(index / 4)) >> ((index % 4) * 2) & 3;
        if (statusCode !== core.statusCodes[core.AttendanceStatus.UNPROCESSED]) statuses.push([index, core.statusCodes[statusCode]]);
    });
    return statuses;
}

async function refreshSyncQr(): Promise<void> {
    const payload = await createSyncPayload();
    await QRCode.toCanvas(core.syncCanvas, payload, { errorCorrectionLevel: "M", margin: 2, width: 320 });
}

const liveSnapshotPrefix = "vex-sync:";
const liveKeepAlivePrefix = "vex-live:";
const liveDeviceCountPrefix = "vex-devices:";
const liveOfferPrefix = "vex-offer:";
const liveAnswerPrefix = "vex-answer:";
const liveOfferCompressedPrefix = "vex-o2:";
const liveAnswerCompressedPrefix = "vex-a2:";

function setLiveSyncStatus(message: string, connected: boolean = false): void {
    core.liveSyncStatus.textContent = message;
    core.liveSyncStatus.classList.toggle("connected", connected);
}

function getCompressionStreamConstructor(): core.CompressionStreamConstructor | undefined {
    return (globalThis as unknown as { CompressionStream?: core.CompressionStreamConstructor }).CompressionStream;
}

function getDecompressionStreamConstructor(): core.DecompressionStreamConstructor | undefined {
    return (globalThis as unknown as { DecompressionStream?: core.DecompressionStreamConstructor }).DecompressionStream;
}

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function compressLiveQrPayload(payload: core.LiveOfferPayload | core.LiveAnswerPayload): Promise<{ prefix: "gzip" | "plain"; value: string }> {
    const CompressionStreamImpl = getCompressionStreamConstructor();
    if (!CompressionStreamImpl) throw new Error("Gzip QR compression is not supported by this browser.");
    const compact = [
        payload.t === "webrtc-offer" ? "o" : "a",
        payload.e,
        payload.h,
        payload.session,
        payload.sdp.type,
        payload.sdp.sdp || "",
    ] as const;
    const json = JSON.stringify(compact);
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStreamImpl("gzip"));
    return { prefix: "gzip", value: bytesToBase64Url(new Uint8Array(await new Response(stream).arrayBuffer())) };
}

async function decompressLiveQrPayload(value: string, compressed: boolean): Promise<core.LiveOfferPayload | core.LiveAnswerPayload> {
    const bytes = base64UrlToBytes(value);
    const DecompressionStreamImpl = getDecompressionStreamConstructor();
    if (!compressed || !DecompressionStreamImpl) {
        return JSON.parse(new TextDecoder().decode(bytes)) as core.LiveOfferPayload | core.LiveAnswerPayload;
    }

    const exactBytes = new Uint8Array(bytes.byteLength);
    exactBytes.set(bytes);
    const stream = new Blob([exactBytes]).stream().pipeThrough(new DecompressionStreamImpl("gzip"));
    const json = await new Response(stream).text();
    const compact = JSON.parse(json) as [string, string, string, string, "offer" | "answer", string];
    const [kind, eventId, hashPrefix, session, sdpType, sdp] = compact;
    if (!["o", "a"].includes(kind)
        || typeof eventId !== "string"
        || typeof hashPrefix !== "string"
        || typeof session !== "string"
        || typeof sdpType !== "string"
        || typeof sdp !== "string") {
        throw new Error("The compressed live-sync QR code is invalid.");
    }
    return kind === "o"
        ? { t: "webrtc-offer", v: 1, e: eventId, h: hashPrefix, session, sdp: { type: sdpType, sdp } }
        : { t: "webrtc-answer", v: 1, e: eventId, h: hashPrefix, session, sdp: { type: sdpType, sdp } };
}

function showLiveSyncSuccess(message: string): void {
    core.liveSyncSuccessMessage.textContent = message;
    if (!core.liveSyncSuccessDialog.open) core.liveSyncSuccessDialog.showModal();
}

let syncToastTimer: number | null = null;

function showSyncToast(message: string, hasOverrides: boolean = false): void {
    core.syncToastMessage.textContent = message;
    core.syncToast.classList.toggle("has-overrides", hasOverrides);
    core.syncToast.hidden = false;
    if (syncToastTimer !== null) window.clearTimeout(syncToastTimer);
    syncToastTimer = window.setTimeout(() => {
        core.syncToast.hidden = true;
        syncToastTimer = null;
    }, 7000);
}

function setLiveSyncIndicator(active: boolean, detail: string, deviceCount: number = 0): void {
    core.liveSyncIndicator.hidden = !active;
    core.liveSyncIndicator.setAttribute("aria-label", detail);
    core.liveSyncIndicator.title = detail;
    core.liveSyncDeviceCount.textContent = String(deviceCount);
}

function broadcastLiveDeviceCount(): void {
    if (liveRole !== LiveSyncRole.HOST) return;
    if (!hostChannels.size) {
        setLiveSyncIndicator(false, "Live sync inactive");
        return;
    }
    const count = hostChannels.size + 1;
    setLiveSyncIndicator(true, `${count} devices connected`, count);
    hostChannels.forEach((channel) => {
        if (channel.readyState === "open") channel.send(liveDeviceCountPrefix + count);
    });
}

function startLiveKeepAlive(): void {
    if (liveKeepAliveTimer !== null) window.clearInterval(liveKeepAliveTimer);
    liveKeepAliveTimer = window.setInterval(() => {
        if (liveRole === LiveSyncRole.HOST) {
            hostChannels.forEach((channel) => {
                if (channel.readyState === "open") channel.send(liveKeepAlivePrefix + "ping");
            });
        } else if (clientChannel?.readyState === "open") {
            clientChannel.send(liveKeepAlivePrefix + "ping");
        }
    }, 60000);
}

function stopLiveKeepAlive(): void {
    if (liveKeepAliveTimer === null) return;
    window.clearInterval(liveKeepAliveTimer);
    liveKeepAliveTimer = null;
}

async function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
    if (peer.iceGatheringState === "complete") return;
    await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(() => resolve(), 2500);
        const checkComplete = (): void => {
            if (peer.iceGatheringState !== "complete") return;
            window.clearTimeout(timeout);
            peer.removeEventListener("icegatheringstatechange", checkComplete);
            resolve();
        };
        peer.addEventListener("icegatheringstatechange", checkComplete);
    });
}

function getLivePeerRole(peer: RTCPeerConnection): void {
    peer.addEventListener("connectionstatechange", () => {
        if (peer.connectionState === "connected") {
            const message = liveRole === LiveSyncRole.HOST ? "Live host connected" : "Connected to live host";
            setLiveSyncStatus(message, true);
            setLiveSyncIndicator(true, message, liveRole === LiveSyncRole.HOST ? hostChannels.size + 1 : 1);
            showLiveSyncSuccess(message);
            startLiveKeepAlive();
        } else if (peer.connectionState === "disconnected" || peer.connectionState === "failed") {
            setLiveSyncStatus("Live sync disconnected");
            setLiveSyncIndicator(false, "Live sync inactive");
            stopLiveKeepAlive();
        }
    });
}

async function broadcastLiveSnapshot(): Promise<void> {
    if (core.syncRuntime.liveApplyingSnapshot) return;
    const snapshot = await createSyncPayload();
    const message = liveSnapshotPrefix + snapshot;
    if (liveRole === LiveSyncRole.HOST) {
        hostChannels.forEach((channel) => {
            if (channel.readyState === "open") channel.send(message);
        });
    } else if (clientChannel?.readyState === "open") {
        clientChannel.send(message);
    }
}

async function receiveLiveSnapshot(raw: string): Promise<void> {
    core.syncRuntime.liveApplyingSnapshot = true;
    try {
        if (liveInitialSnapshotPending) {
            if (liveRole === LiveSyncRole.HOST) {
                await applySyncPayload(raw, true);
            } else {
                await applyLiveSnapshot(raw, true, true);
            }
        } else {
            await applyLiveSnapshot(raw, true);
        }
    } finally {
        core.syncRuntime.liveApplyingSnapshot = false;
        liveInitialSnapshotPending = false;
    }
    if (liveRole === LiveSyncRole.HOST) await broadcastLiveSnapshot();
}

function configureHostChannel(session: string, channel: RTCDataChannel): void {
    hostChannels.set(session, channel);
    channel.addEventListener("open", () => {
        const message = `Live host: ${hostChannels.size} device${hostChannels.size === 1 ? "" : "s"} connected`;
        setLiveSyncStatus(message, true);
        setLiveSyncIndicator(true, message, hostChannels.size);
        broadcastLiveDeviceCount();
        showLiveSyncSuccess(message);
        liveInitialSnapshotPending = true;
        startLiveKeepAlive();
        void broadcastLiveSnapshot();
    });
    channel.addEventListener("close", () => {
        hostChannels.delete(session);
        hostPeers.delete(session);
        broadcastLiveDeviceCount();
        setLiveSyncStatus(hostChannels.size
            ? `Live host: ${hostChannels.size} device${hostChannels.size === 1 ? "" : "s"} connected`
            : "Live sync disconnected");
    });
    channel.addEventListener("message", (event) => {
        const message = String(event.data);
        if (message.startsWith(liveKeepAlivePrefix)) return;
        if (!message.startsWith(liveSnapshotPrefix)) return;
        void receiveLiveSnapshot(message.slice(liveSnapshotPrefix.length)).catch((syncError) => {
            core.showErrorPopup(syncError instanceof Error ? syncError.message : String(syncError));
        });
    });
}

async function createLiveHostOffer(): Promise<void> {
    if (!core.state.eventId || !core.state.records.length) throw new Error("Select an event before hosting live sync.");
    liveRole = LiveSyncRole.HOST;
    core.hostWebRTCButton.disabled = true;
    core.joinWebRTCButton.disabled = true;
    core.disconnectWebRTCButton.disabled = false;
    core.liveRoleInstructions.hidden = false;
    core.liveQrPanel.hidden = false;
    core.liveScannerPanel.hidden = false;
    core.regenerateLiveQrButton.hidden = false;
    core.liveRoleTitle.textContent = "Host instructions";
    core.liveRoleHelp.textContent = "Connect the guest device to this device's hotspot, then scan this QR code with the guest device.";
    core.liveSyncCanvas.hidden = false;
    const peer = new RTCPeerConnection();
    getLivePeerRole(peer);
    const session = crypto.randomUUID();
    const channel = peer.createDataChannel("attendance");
    configureHostChannel(session, channel);
    hostPeers.set(session, peer);
    peer.addEventListener("connectionstatechange", () => {
        if (peer.connectionState === "failed" || peer.connectionState === "closed") {
            hostPeers.delete(session);
        }
    });
    await peer.setLocalDescription(await peer.createOffer());
    await waitForIceGathering(peer);
    if (!peer.localDescription) throw new Error("Live sync could not create an offer.");
    const payload: core.LiveOfferPayload = {
        t: "webrtc-offer",
        v: 1,
        e: core.state.eventId,
        h: await core.getDatasetHash(),
        session,
        sdp: peer.localDescription.toJSON(),
    };
    const compressed = await compressLiveQrPayload(payload);
    if (compressed.prefix !== "gzip") throw new Error("Gzip QR compression is required for live sync.");
    const offerQr = liveOfferCompressedPrefix + compressed.value;
    await QRCode.toCanvas(core.liveSyncCanvas, offerQr, {
        errorCorrectionLevel: "L",
        margin: 2,
        width: 420,
    });
    core.liveSyncMessage.textContent = "Let a device scan this live-sync offer.";
    setLiveSyncStatus("Live host offer ready");
}

async function joinLiveHostOffer(raw: string, compressed: boolean = false): Promise<void> {
    const payload = (compressed
        ? await decompressLiveQrPayload(raw, true)
        : JSON.parse(raw)) as core.LiveOfferPayload;
    if (payload.t !== "webrtc-offer"
        || payload.v !== 1
        || payload.e !== core.state.eventId
        || typeof payload.session !== "string"
        || !payload.sdp) {
        throw new Error("This live-sync offer is not valid for the selected event.");
    }
    if (payload.h !== await core.getDatasetHash()) {
        throw new Error("The live-sync data.csv fingerprint does not match this device.");
    }
    liveRole = LiveSyncRole.CLIENT;
    core.hostWebRTCButton.disabled = true;
    core.joinWebRTCButton.disabled = true;
    core.disconnectWebRTCButton.disabled = false;
    core.liveRoleInstructions.hidden = false;
    core.liveQrPanel.hidden = false;
    core.regenerateLiveQrButton.hidden = true;
    core.liveRoleTitle.textContent = "Guest instructions";
    core.liveRoleHelp.textContent = "Keep this scanner open. After the host offer is scanned, show the answer QR code to the host.";
    clientPeer?.close();
    clientPeer = new RTCPeerConnection();
    getLivePeerRole(clientPeer);
    clientPeer.addEventListener("datachannel", (event) => {
        clientChannel = event.channel;
        clientChannel.addEventListener("open", () => {
            setLiveSyncStatus("Connected to live host", true);
            setLiveSyncIndicator(true, "Connected to live host", 1);
            liveInitialSnapshotPending = true;
            startLiveKeepAlive();
            void broadcastLiveSnapshot();
        });
        clientChannel.addEventListener("close", () => {
            setLiveSyncStatus("Live sync disconnected");
            setLiveSyncIndicator(false, "Live sync inactive");
            stopLiveKeepAlive();
        });
        clientChannel.addEventListener("message", (messageEvent) => {
            const message = String(messageEvent.data);
            if (message.startsWith(liveKeepAlivePrefix)) return;
            if (message.startsWith(liveDeviceCountPrefix)) {
                const count = Number.parseInt(message.slice(liveDeviceCountPrefix.length), 10);
                if (Number.isFinite(count)) {
                    setLiveSyncIndicator(true, `${count} devices connected`, count);
                }
                return;
            }
            if (!message.startsWith(liveSnapshotPrefix)) return;
            void receiveLiveSnapshot(message.slice(liveSnapshotPrefix.length)).catch((syncError) => {
                core.showErrorPopup(syncError instanceof Error ? syncError.message : String(syncError));
            });
        });
    });
    await clientPeer.setRemoteDescription(payload.sdp);
    await clientPeer.setLocalDescription(await clientPeer.createAnswer());
    await waitForIceGathering(clientPeer);
    if (!clientPeer.localDescription) throw new Error("Live sync could not create an answer.");
    const answer: core.LiveAnswerPayload = {
        t: "webrtc-answer",
        v: 1,
        e: core.state.eventId,
        h: await core.getDatasetHash(),
        session: payload.session,
        sdp: clientPeer.localDescription.toJSON(),
    };
    core.liveSyncCanvas.hidden = false;
    const compressedAnswer = await compressLiveQrPayload(answer);
    if (compressedAnswer.prefix !== "gzip") throw new Error("Gzip QR compression is required for live sync.");
    const answerQr = liveAnswerCompressedPrefix + compressedAnswer.value;
    await QRCode.toCanvas(core.liveSyncCanvas, answerQr, {
        errorCorrectionLevel: "L",
        margin: 2,
        width: 420,
    });
    core.liveSyncMessage.textContent = "Live-sync answer ready. Let the host scan this QR code.";
    showLiveSyncSuccess("Host offer scanned successfully. Show this answer QR to the host.");
}

async function acceptLiveHostAnswer(raw: string, compressed: boolean = false): Promise<void> {
    if (liveRole !== LiveSyncRole.HOST) throw new Error("This device is not hosting live sync.");
    const payload = (compressed
        ? await decompressLiveQrPayload(raw, true)
        : JSON.parse(raw)) as core.LiveAnswerPayload;
    if (payload.t !== "webrtc-answer"
        || payload.v !== 1
        || payload.e !== core.state.eventId
        || typeof payload.session !== "string"
        || !payload.sdp) {
        throw new Error("This live-sync answer is not valid.");
    }
    if (payload.h !== await core.getDatasetHash()) {
        throw new Error("The live-sync data.csv fingerprint does not match this device.");
    }
    if (acceptedHostAnswers.has(payload.session)) return;
    const peer = hostPeers.get(payload.session);
    if (!peer) throw new Error("This live-sync answer does not match an active host offer.");
    await peer.setRemoteDescription(payload.sdp);
    acceptedHostAnswers.add(payload.session);
    core.liveSyncMessage.textContent = "Connecting live-sync device...";
    showLiveSyncSuccess("Answer QR scanned successfully. Connecting to the live device...");
}

async function handleLiveQr(raw: string): Promise<boolean> {
    if (raw.startsWith(liveOfferCompressedPrefix)) {
        await joinLiveHostOffer(raw.slice(liveOfferCompressedPrefix.length), true);
        return true;
    }
    if (raw.startsWith(liveOfferPrefix)) {
        await joinLiveHostOffer(raw.slice(liveOfferPrefix.length));
        return true;
    }
    if (raw.startsWith(liveAnswerCompressedPrefix)) {
        await acceptLiveHostAnswer(raw.slice(liveAnswerCompressedPrefix.length), true);
        return true;
    }
    if (raw.startsWith(liveAnswerPrefix)) {
        await acceptLiveHostAnswer(raw.slice(liveAnswerPrefix.length));
        return true;
    }
    return false;
}

async function applyLiveSnapshot(raw: string, showChanges: boolean = true, initialGuest: boolean = false): Promise<void> {
    const payload = JSON.parse(raw) as core.ParsedSyncPayload;
    const validPayload = payload.e === core.state.eventId
        && typeof payload.h === "string"
        && ((payload.v === 2 && typeof payload.s === "string")
            || (payload.v === 1 && Array.isArray(payload.s)));
    if (!validPayload) throw new Error("This live sync snapshot is not valid for the selected event.");
    if (payload.h !== await core.getDatasetHash()) {
        throw new Error("The live sync data.csv fingerprint does not match this device.");
    }

    const statuses = payload.v === 2
        ? decodePackedStatuses(payload.s as string)
        : payload.s as Array<[number, core.AttendanceStatus]>;
    const overridden: string[] = [];
    let changedCount = 0;
    const incomingStatuses = new Map<number, core.AttendanceStatus>();
    core.state.records.forEach((_, index) => incomingStatuses.set(index, core.AttendanceStatus.UNPROCESSED));
    statuses.forEach((entry) => {
        if (Array.isArray(entry) && typeof entry[0] === "number" && core.isAttendanceStatus(entry[1])) {
            incomingStatuses.set(entry[0], entry[1]);
        }
    });

    core.state.records.forEach((record, index) => {
        const incoming = incomingStatuses.get(index) || core.AttendanceStatus.UNPROCESSED;
        const local = core.getAttendanceStatus(record);
        if (initialGuest && local !== incoming) {
            overridden.push(`${record.name}: ${local} -> ${incoming}`);
            changedCount += 1;
            return;
        }
        if (local !== incoming) {
            overridden.push(`${record.name}: ${local} -> ${incoming}`);
            changedCount += 1;
        }
        core.state.attendance[core.attendanceKey(record)] = incoming;
    });

    core.saveAttendance();
    core.renderPreservingScrollCallback();
    await refreshSyncQr();

    if (!showChanges) return;

    if (initialGuest && overridden.length > 0) {
        guestAwaitingConflictResolution = true;
        core.liveConflictPendingMessage.textContent =
            `${overridden.length} conflicting status${overridden.length === 1 ? "" : "es"} are waiting for the host to resolve.`;
        if (!core.liveConflictPendingDialog.open) core.liveConflictPendingDialog.showModal();
        return;
    }

    if (!initialGuest && guestAwaitingConflictResolution) {
        guestAwaitingConflictResolution = false;
        if (core.liveConflictPendingDialog.open) core.liveConflictPendingDialog.close();
    }

    if (overridden.length > 0) {
        showSyncToast(`${overridden.length} status${overridden.length === 1 ? "" : "es"} overridden`, true);
    }
}

async function applySyncPayload(raw: string, liveInitial: boolean = false): Promise<void> {
    if (await handleLiveQr(raw)) return;
    if (raw.startsWith(liveSnapshotPrefix)) {
        await receiveLiveSnapshot(raw.slice(liveSnapshotPrefix.length));
        return;
    }
    const payload = JSON.parse(raw) as core.ParsedSyncPayload;
    const validPayload = payload.e === core.state.eventId
        && typeof payload.h === "string"
        && ((payload.v === 2 && typeof payload.s === "string")
            || (payload.v === 1 && Array.isArray(payload.s)));
    if (!validPayload) {
        throw new Error("This QR code is not valid for the selected event.");
    }
    if (payload.h !== await core.getDatasetHash()) {
        throw new Error("The data.csv fingerprint does not match this device.");
    }
    discrepancies.clear();
    pendingSyncChoices.clear();
    const importedCounts = new Map<core.AttendanceStatus, number>(core.attendanceStatuses.map((status) => [status, 0]));
    const statuses = payload.v === 2
        ? decodePackedStatuses(payload.s as string)
        : payload.s as Array<[number, core.AttendanceStatus]>;
    statuses.forEach((entry) => {
        if (!Array.isArray(entry) || typeof entry[0] !== "number" || !core.isAttendanceStatus(entry[1]) || !core.state.records[entry[0]]) return;
        const record = core.state.records[entry[0]];
        const incoming = entry[1];
        const local = core.getAttendanceStatus(record);
        if (local !== core.AttendanceStatus.UNPROCESSED && local !== incoming) {
            discrepancies.set(core.attendanceKey(record), { name: record.name, local, incoming });
            pendingSyncChoices.set(core.attendanceKey(record), { record, incoming });
            return;
        }
        core.state.attendance[core.attendanceKey(record)] = incoming;
        importedCounts.set(incoming, (importedCounts.get(incoming) || 0) + 1);
    });
    core.saveAttendance();
    core.renderPreservingScrollCallback();
    const importedCount = [...importedCounts.values()].reduce((total, count) => total + count, 0);
    await refreshSyncQr();
    core.syncMessage.textContent = discrepancies.size ? "Review the flagged differences before applying them." : "Ready to scan or share the updated QR code.";
    core.syncStatusTally.replaceChildren(...[
        [core.AttendanceStatus.PRESENT, "Present", "check"],
        [core.AttendanceStatus.ABSENT, "Absent", "close"],
        [core.AttendanceStatus.FLAGGED, "Flagged", "flag"],
    ].map(([status, label, icon]) => {
        const item = core.syncStatusTallyTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
        item.classList.add(status as string);
        core.child<HTMLElement>(item, ".sync-tally-icon").textContent = icon as string;
        core.child<HTMLElement>(item, ".sync-tally-count").textContent = String(importedCounts.get(status as core.AttendanceStatus) || 0);
        core.child<HTMLElement>(item, ".sync-tally-label").textContent = label as string;
        return item;
    }));
    const statusIcons: Record<core.AttendanceStatus, string> = {
        [core.AttendanceStatus.UNPROCESSED]: "question_mark",
        [core.AttendanceStatus.PRESENT]: "check",
        [core.AttendanceStatus.ABSENT]: "close",
        [core.AttendanceStatus.FLAGGED]: "flag",
    };
    const table = core.syncReviewTableTemplate.content.firstElementChild!.cloneNode(true) as HTMLTableElement;
    const body = core.child<HTMLTableSectionElement>(table, "tbody");
    [...pendingSyncChoices].forEach(([key, choice]) => {
        const row = core.syncReviewRowTemplate.content.firstElementChild!.cloneNode(true) as HTMLTableRowElement;
        const local = core.getAttendanceStatus(choice.record);
        core.child<HTMLElement>(row, ".sync-review-team-number").textContent = choice.record.teamCode;
        core.child<HTMLElement>(row, ".sync-review-division").textContent = `${choice.record.division} · ${choice.record.organisation}`;
        core.child<HTMLElement>(row, ".sync-review-person").textContent = choice.record.name;
        const choiceButtons = row.querySelectorAll<HTMLButtonElement>(".sync-choice-button");
        const options: Array<[string, core.AttendanceStatus, string]> = [
            ["local", local, "This device"],
            ["incoming", choice.incoming, "Scanned device"],
        ];
        options.forEach(([source, status, label], index) => {
            const button = choiceButtons[index];
            button.dataset.syncChoice = key;
            button.dataset.syncSource = source;
            button.dataset.syncStatus = status;
            button.setAttribute("aria-pressed", source === "local" ? "true" : "false");
            button.setAttribute("aria-label", `${label}: ${status}`);
            const icon = document.createElement("span");
            icon.className = `material-symbols-outlined sync-status-icon ${status}`;
            icon.setAttribute("aria-hidden", "true");
            icon.textContent = statusIcons[status];
            const statusLabel = document.createElement("span");
            statusLabel.className = "sync-status-label";
            statusLabel.textContent = status;
            button.replaceChildren(icon, statusLabel);
        });
        body.append(row);
    });
    core.syncReviewList.replaceChildren(table);
    core.syncConflictHeading.hidden = false;
    const hasConflicts = pendingSyncChoices.size > 0;
    core.syncConflictIcon.textContent = hasConflicts ? "warning" : "check_circle";
    core.syncConflictLabelText.textContent = hasConflicts ? "Conflicts to resolve" : "No conflicts to resolve";
    core.syncConflictHeading.classList.toggle("has-conflicts", hasConflicts);
    core.syncReviewList.hidden = !hasConflicts;
    core.applySyncReviewButton.hidden = !hasConflicts;
    core.syncReviewSummary.textContent = pendingSyncChoices.size
        ? `${importedCount} imported successfully. ${pendingSyncChoices.size} conflicting status${pendingSyncChoices.size === 1 ? "" : "es"} need review.`
        : `${importedCount} status${importedCount === 1 ? "" : "es"} imported successfully.`;
    // The first live pairing snapshot may contain conflicts. Regular QR scans
    // keep the existing summary behavior, while later live snapshots auto-merge.
    if (!liveInitial || pendingSyncChoices.size > 0) {
        if (!core.syncReviewDialog.open) core.syncReviewDialog.showModal();
    }
}

core.searchInput.addEventListener("input", (event) => {
    core.state.query = (event.target as HTMLInputElement).value.trim();
    core.renderPreservingScrollCallback();
});
core.eventFilter.addEventListener("change", (event) => {
    const nextEventId = (event.target as HTMLSelectElement).value;
    if (!nextEventId) {
        core.eventFilter.value = core.state.eventId;
        return;
    }
    if (nextEventId === core.state.eventId) return;
    const nextEvent = core.events.find((item) => item.id === nextEventId);
    const nextEventLabel = nextEvent?.label || "Select event...";
    if (core.state.eventId && !window.confirm(`Switch to ${nextEventLabel}? Attendance is tracked separately for each event.`)) {
        core.eventFilter.value = core.state.eventId;
        return;
    }
    void app.switchEvent(nextEventId);
});
core.clearButton.addEventListener("click", () => {
    core.searchInput.value = "";
    core.state.query = "";
    core.searchInput.focus();
    core.renderPreservingScrollCallback();
});
core.teamFilter.addEventListener("change", (event) => {
    core.state.teamCode = (event.target as HTMLSelectElement).value;
    core.renderPreservingScrollCallback();
});
core.statusFilter.addEventListener("change", () => {
    core.state.statusFilters = [...core.statusFilter.querySelectorAll<HTMLInputElement>("input:checked")]
        .map((input) => input.value as core.AttendanceStatus);
    core.renderPreservingScrollCallback();
});
core.inspectionFilter.addEventListener("change", () => {
    core.state.inspectionFilters = [...core.inspectionFilter.querySelectorAll<HTMLInputElement>("input:checked")]
        .map((input) => input.value as core.InspectionStatus);
    core.renderPreservingScrollCallback();
});
core.divisionFilter.addEventListener("change", () => {
    core.renderPreservingScrollCallback();
});
core.clearFiltersButton.addEventListener("click", () => {
    core.searchInput.value = "";
    core.teamFilter.value = "";
    core.divisionFilter.querySelectorAll<HTMLInputElement>("input").forEach((input) => { input.checked = false; });
    core.statusFilter.querySelectorAll<HTMLInputElement>("input").forEach((input) => { input.checked = false; });
    core.inspectionFilter.querySelectorAll<HTMLInputElement>("input").forEach((input) => { input.checked = false; });
    core.state.query = "";
    core.state.teamCode = "";
    core.state.statusFilters = [];
    core.state.inspectionFilters = [];
    core.renderPreservingScrollCallback();
});
core.toggleFiltersButton.addEventListener("click", () => {
    const filterControls = core.query<HTMLElement>(".filter-controls");
    const expanded = filterControls.classList.toggle("open");
    core.toggleFiltersButton.setAttribute("aria-expanded", String(expanded));
    core.toggleFiltersButton.setAttribute("aria-label", expanded ? "Hide filters" : "Show filters");
    core.toggleFiltersButton.title = expanded ? "Hide filters" : "Show filters";
    core.toggleFiltersIcon.textContent = expanded ? "filter_alt" : "filter_list";
    app.scheduleLayoutRecalculation();
});
core.toggleTeamsButton.addEventListener("click", () => {
    const groups = [...core.results.querySelectorAll<HTMLElement>(".team-group")];
    if (!groups.length) return;

    const allExpanded = groups.every((group) => !group.classList.contains("collapsed"));
    const toolbarHeight = core.controlToolbar.getBoundingClientRect().height;
    const organisationHeading = core.results.querySelector(".organisation-heading");
    const organisationHeadingHeight = organisationHeading
        ? organisationHeading.getBoundingClientRect().height
        : 42;
    const teamStickyTop = core.controlToolbar.getBoundingClientRect().top
        + toolbarHeight
        + organisationHeadingHeight
        + 10;
    const anchor = groups.find((group) => {
        const rect = group.getBoundingClientRect();
        return rect.top >= teamStickyTop && rect.top < window.innerHeight;
    }) || groups.find((group) => {
        const rect = group.getBoundingClientRect();
        return rect.bottom > teamStickyTop && rect.top < window.innerHeight;
    });
    const anchorOffset = anchor
        ? anchor.getBoundingClientRect().top - teamStickyTop
        : 0;
    const targetExpanded = !allExpanded;


    groups.forEach((group) => { app.setTeamExpanded(group, targetExpanded); });
    app.updateToggleTeamsButton();

    if (!anchor) return;
    const keepAnchor = () => {
        const currentTop = anchor.getBoundingClientRect().top;
        const currentToolbarTop = core.controlToolbar.getBoundingClientRect().top;
        const currentToolbarHeight = core.controlToolbar.getBoundingClientRect().height;
        const currentOrganisationHeading = core.results.querySelector(".organisation-heading");
        const currentOrganisationHeight = currentOrganisationHeading
            ? currentOrganisationHeading.getBoundingClientRect().height
            : organisationHeadingHeight;
        const currentTeamStickyTop = currentToolbarTop
            + currentToolbarHeight
            + currentOrganisationHeight
            + 10;
        const correction = currentTop - currentTeamStickyTop - anchorOffset;
        if (Math.abs(correction) < 0.1) return;
        window.scrollTo({
            top: Math.max(0, window.scrollY + correction),
            left: 0,
            behavior: "auto",
        });
    };
    const start = performance.now();
    const maintainAnchor = (now) => {
        keepAnchor();
        if (now - start < core.teamAnimationDuration) {
            requestAnimationFrame(maintainAnchor);
        } else {
            keepAnchor();
        }
    };
    requestAnimationFrame(maintainAnchor);
});
core.results.addEventListener("click", (event) => {
    const inspectionButton = (event.target as Element).closest<HTMLButtonElement>("[data-team-inspection]");
    if (inspectionButton) {
        const team = inspectionButton.dataset.team;
        const division = inspectionButton.dataset.division;
        if (!team || (division !== core.Division.ES && division !== core.Division.MS)) return;
        const key = core.inspectionKey(team, division);
        const currentStatus = core.getTeamInspectionStatus(team, division);
        core.state.inspection[key] = currentStatus === core.InspectionStatus.INSPECTED
            ? core.InspectionStatus.PARTIALLY_INSPECTED
            : currentStatus === core.InspectionStatus.PARTIALLY_INSPECTED
                ? core.InspectionStatus.NOT_INSPECTED
                : core.InspectionStatus.INSPECTED;
        core.saveInspection();
        core.renderPreservingScrollCallback();
        return;
    }
    const teamButton = (event.target as Element).closest<HTMLButtonElement>("[data-team-status]");
    if (teamButton) {
        core.state.records
            .filter((record) => record.teamCode === teamButton.dataset.team && record.division === teamButton.dataset.division)
            .forEach((record) => {
                const status = teamButton.dataset.teamStatus;
                if (status && core.isAttendanceStatus(status)) core.state.attendance[core.attendanceKey(record)] = status;
            });
        core.saveAttendance();
        core.renderPreservingScrollCallback();
        return;
    }
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-status]");
    if (button) {
        const [team, division, name] = button.dataset.attendance.split(":");
        const record = core.state.records.find((item) => item.teamCode === team && item.division === division && item.name === name);
        if (!record) return;
        if (!button.dataset.status || !core.isAttendanceStatus(button.dataset.status)) return;
        core.state.attendance[core.attendanceKey(record)] = button.dataset.status;
        core.saveAttendance();
        core.renderPreservingScrollCallback();
        return;
    }

    const person = (event.target as Element).closest<HTMLElement>(".person-row");
    if (!person) return;
    const record = core.state.records.find((item) => item.teamCode === person.dataset.teamCode
        && item.division === person.dataset.division
        && item.name === person.dataset.personName);
    if (!record) return;
    const currentStatus = core.getAttendanceStatus(record);
    const nextStatus = core.attendanceStatuses[(core.attendanceStatuses.indexOf(currentStatus) + 1) % core.attendanceStatuses.length];
    core.state.attendance[core.attendanceKey(record)] = nextStatus;
    core.saveAttendance();
    core.renderPreservingScrollCallback();
});
core.resetButton.addEventListener("click", () => {
    if (!window.confirm("Delete all saved attendance data for today? This cannot be undone.")) return;
    core.state.records.forEach((record) => { delete core.state.attendance[core.attendanceKey(record)]; });
    core.saveAttendance();
    app.render();
});
core.hostWebRTCButton.addEventListener("click", () => {
    void startSyncCamera(undefined, core.liveSyncVideo, core.liveCameraSelect, core.liveCameraSelectWrap, true)
        .then(() => { core.liveSyncVideo.hidden = false; })
        .then(() => createLiveHostOffer())
        .then(() => liveScanRunner?.())
        .catch((liveError) => {
            setLiveSyncStatus("Live sync could not start");
            core.showErrorPopup(liveError instanceof Error ? liveError.message : String(liveError));
        });
});
core.joinWebRTCButton.addEventListener("click", () => {
    liveRole = LiveSyncRole.CLIENT;
    core.hostWebRTCButton.disabled = true;
    core.joinWebRTCButton.disabled = true;
    core.disconnectWebRTCButton.disabled = false;
    core.liveQrPanel.hidden = true;
    core.liveScannerPanel.hidden = false;
    core.liveSyncVideo.hidden = false;
    core.liveRoleInstructions.hidden = false;
    core.regenerateLiveQrButton.hidden = true;
    core.liveRoleTitle.textContent = "Guest instructions";
    core.liveRoleHelp.textContent = "Connect to the host device's hotspot, then scan the host QR code.";
    setLiveSyncStatus("Scan a host live-sync QR code");
    core.liveSyncMessage.textContent = "Scanning for a host live-sync offer.";
    void startSyncCamera(undefined, core.liveSyncVideo, core.liveCameraSelect, core.liveCameraSelectWrap, true)
        .then(() => liveScanRunner?.())
        .catch((liveError) => core.showErrorPopup(liveError instanceof Error ? liveError.message : String(liveError)));
});
core.disconnectWebRTCButton.addEventListener("click", disconnectLiveSync);
core.regenerateLiveQrButton.addEventListener("click", () => {
    void createLiveHostOffer().catch((liveError) => {
        core.showErrorPopup(liveError instanceof Error ? liveError.message : String(liveError));
    });
});
core.syncAttendanceButton.addEventListener("click", () => {
    core.syncMethodDialog.showModal();
});

async function openQrSync(): Promise<void> {
    core.syncMethodDialog.close();
    core.syncMessage.textContent = "Preparing sync QR code and camera...";
    core.syncCanvas.hidden = false;
    core.syncVideo.hidden = false;
    core.syncDialog.showModal();
    void lockSyncOrientation();
    await refreshSyncQr();
    await startSyncCamera();
    core.syncMessage.textContent = "Show this QR code to another device or scan its QR code.";
    const BarcodeDetectorConstructor = window.BarcodeDetector;
    const detector = BarcodeDetectorConstructor
        ? new BarcodeDetectorConstructor({ formats: ["qr_code"] })
        : null;
    const scan = async (): Promise<void> => {
        if (!scanLoopActive || !syncStream || core.syncVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
        let rawValue: string | undefined;
        if (detector) {
            const codes = await detector.detect(core.syncVideo);
            rawValue = codes[0]?.rawValue;
        } else if (core.syncScanContext) {
            core.syncScanCanvas.width = core.syncVideo.videoWidth;
            core.syncScanCanvas.height = core.syncVideo.videoHeight;
            core.syncScanContext.drawImage(core.syncVideo, 0, 0, core.syncScanCanvas.width, core.syncScanCanvas.height);
            const image = core.syncScanContext.getImageData(0, 0, core.syncScanCanvas.width, core.syncScanCanvas.height);
            rawValue = jsQR(image.data, image.width, image.height)?.data;
        }
        if (rawValue) {
            const now = Date.now();
            if (rawValue !== lastScannedPayload || now - lastScannedAt > 1500) {
                lastScannedPayload = rawValue;
                lastScannedAt = now;
                try {
                    await applySyncPayload(rawValue);
                } catch (syncError) {
                    core.showErrorPopup(syncError instanceof Error ? syncError.message : String(syncError));
                }
            }
        }
        requestAnimationFrame(() => { void scan(); });
    };
    void scan();
}

async function openLiveSync(): Promise<void> {
    core.syncMethodDialog.close();
    disconnectLiveSync();
    core.liveSyncCanvas.hidden = true;
    core.liveSyncVideo.hidden = true;
    core.liveSyncDialog.showModal();
    void lockSyncOrientation();
    core.liveSyncMessage.textContent = "Choose whether this device is hosting or joining.";
    core.liveQrPanel.hidden = true;
    core.liveScannerPanel.hidden = true;
    liveScanRunner = null;
    const BarcodeDetectorConstructor = window.BarcodeDetector;
    const detector = BarcodeDetectorConstructor
        ? new BarcodeDetectorConstructor({ formats: ["qr_code"] })
        : null;
    const scan = async (): Promise<void> => {
        if (!liveScanLoopActive || !syncStream || core.liveSyncVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
        let rawValue: string | undefined;
        if (detector) {
            const codes = await detector.detect(core.liveSyncVideo);
            rawValue = codes[0]?.rawValue;
        } else if (core.liveSyncScanContext) {
            core.liveSyncScanCanvas.width = core.liveSyncVideo.videoWidth;
            core.liveSyncScanCanvas.height = core.liveSyncVideo.videoHeight;
            core.liveSyncScanContext.drawImage(core.liveSyncVideo, 0, 0, core.liveSyncScanCanvas.width, core.liveSyncScanCanvas.height);
            const image = core.liveSyncScanContext.getImageData(0, 0, core.liveSyncScanCanvas.width, core.liveSyncScanCanvas.height);
            rawValue = jsQR(image.data, image.width, image.height)?.data;
        }
        if (rawValue) {
            const now = Date.now();
            if (rawValue !== lastScannedPayload || now - lastScannedAt > 1500) {
                lastScannedPayload = rawValue;
                lastScannedAt = now;
                try {
                    await applySyncPayload(rawValue);
                } catch (syncError) {
                    core.showErrorPopup(syncError instanceof Error ? syncError.message : String(syncError));
                }
            }
        }
        requestAnimationFrame(() => { void scan(); });
    };
    liveScanRunner = () => { void scan(); };
}

core.chooseQrSyncButton.addEventListener("click", () => {
    void openQrSync().catch((syncError) => {
        core.showErrorPopup(syncError instanceof Error ? syncError.message : String(syncError));
    });
});
core.chooseLiveSyncButton.addEventListener("click", () => {
    void openLiveSync().catch((syncError) => {
        core.showErrorPopup(syncError instanceof Error ? syncError.message : String(syncError));
    });
});
core.cameraSelect.addEventListener("change", () => {
    void startSyncCamera(core.cameraSelect.value).catch((scanError) => {
        core.showErrorPopup(scanError instanceof Error ? scanError.message : String(scanError));
    });
});
core.liveCameraSelect.addEventListener("change", () => {
    void startSyncCamera(core.liveCameraSelect.value, core.liveSyncVideo, core.liveCameraSelect, core.liveCameraSelectWrap, true).catch((scanError) => {
        core.showErrorPopup(scanError instanceof Error ? scanError.message : String(scanError));
    });
});
core.closeSyncButton.addEventListener("click", closeSyncDialog);
core.syncDialog.addEventListener("cancel", closeSyncDialog);
core.backQrSyncButton.addEventListener("click", () => backToSyncMethods(true));
core.closeSyncMethodButton.addEventListener("click", () => core.syncMethodDialog.close());
core.syncMethodDialog.addEventListener("cancel", () => core.syncMethodDialog.close());
core.closeLiveSyncButton.addEventListener("click", closeLiveSyncDialog);
core.liveSyncDialog.addEventListener("cancel", closeLiveSyncDialog);
core.backLiveSyncButton.addEventListener("click", () => backToSyncMethods(false));
core.closeLiveSyncSuccessButton.addEventListener("click", () => core.liveSyncSuccessDialog.close());
core.liveSyncSuccessDialog.addEventListener("cancel", () => core.liveSyncSuccessDialog.close());
core.liveConflictPendingDialog.addEventListener("cancel", (event) => event.preventDefault());
core.closeSyncReviewButton.addEventListener("click", () => core.syncReviewDialog.close());
core.closeErrorButton.addEventListener("click", () => core.errorDialog.close());
core.errorDialog.addEventListener("cancel", () => core.errorDialog.close());
core.applySyncReviewButton.addEventListener("click", async () => {
    let appliedCount = 0;
    core.syncReviewList.querySelectorAll<HTMLButtonElement>(".sync-choice-button[aria-pressed='true']").forEach((button) => {
        const choice = pendingSyncChoices.get(button.dataset.syncChoice || "");
        const status = button.dataset.syncStatus;
        if (!choice || !status || !core.isAttendanceStatus(status)) return;
        core.state.attendance[core.attendanceKey(choice.record)] = status;
        appliedCount += 1;
    });
    core.saveAttendance();
    core.renderPreservingScrollCallback();
    pendingSyncChoices.clear();
    discrepancies.clear();
    core.syncReviewDialog.close();
    core.syncMessage.textContent = `Applied ${appliedCount} reviewed status${appliedCount === 1 ? "" : "es"}.`;
    await refreshSyncQr();
    if (liveRole === LiveSyncRole.HOST) await broadcastLiveSnapshot();
});
const chooseAllSyncSource = (source: "local" | "incoming"): void => {
    core.syncReviewList.querySelectorAll<HTMLButtonElement>(".sync-choice-button").forEach((button) => {
        button.setAttribute("aria-pressed", button.dataset.syncSource === source ? "true" : "false");
    });
};
core.syncReviewList.addEventListener("click", (event) => {
    const target = event.target as Element;
    const bulkButton = target.closest<HTMLButtonElement>(".sync-bulk-button");
    if (bulkButton) {
        chooseAllSyncSource(bulkButton.id === "choose-local-all" ? "local" : "incoming");
        return;
    }
    const button = target.closest<HTMLButtonElement>(".sync-choice-button");
    if (!button) return;
    const key = button.dataset.syncChoice;
    if (!key) return;
    core.syncReviewList.querySelectorAll<HTMLButtonElement>(`.sync-choice-button[data-sync-choice="${CSS.escape(key)}"]`).forEach((option) => {
        option.setAttribute("aria-pressed", option === button ? "true" : "false");
    });
});


core.setBroadcastLiveSnapshotCallback(broadcastLiveSnapshot);
