
declare global {
    interface BarcodeDetectorOptions {
        formats?: string[];
    }
    interface DetectedBarcode {
        rawValue?: string;
    }
    class BarcodeDetector {
        constructor(options?: BarcodeDetectorOptions);
        detect(source: CanvasImageSource | HTMLVideoElement): Promise<DetectedBarcode[]>;
    }
    interface Window {
        BarcodeDetector?: typeof BarcodeDetector;
    }
}

export enum AttendanceStatus {
    UNPROCESSED = "unprocessed",
    PRESENT = "present",
    ABSENT = "absent",
    FLAGGED = "flagged"
}
export enum InspectionStatus {
    INSPECTED = "inspected",
    PARTIALLY_INSPECTED = "partially-inspected",
    NOT_INSPECTED = "not-inspected"
}
export enum Division {
    ES = "ES",
    MS = "MS"
}
export type RecordEntry = {
    teamCode: string;
    division: Division;
    organisation: string;
    name: string;
    dob: string;
    school: string;
    image: string;
};
export type EventDefinition = {
    id: string;
    label: string;
};
export type SyncPayload = {
    v: 2;
    e: string;
    h: string;
    s: string;
};
export type ParsedSyncPayload = {
    v?: number;
    e?: string;
    h?: string;
    s?: string | Array<[number, AttendanceStatus]>;
};
export type LiveOfferPayload = {
    t: "webrtc-offer";
    v: 1;
    e: string;
    h: string;
    session: string;
    sdp: RTCSessionDescriptionInit;
};
export type LiveAnswerPayload = {
    t: "webrtc-answer";
    v: 1;
    e: string;
    h: string;
    session: string;
    sdp: RTCSessionDescriptionInit;
};
export type CompressionStreamConstructor = new (format: "gzip") => {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
};
export type DecompressionStreamConstructor = new (format: "gzip") => {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
};

export let events: EventDefinition[] = [];

export const query = <T extends Element>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing required element: ${selector}`);
    return element;
};
export const child = <T extends Element>(parent: Element, selector: string): T => {
    const element = parent.querySelector<T>(selector);
    if (!element) throw new Error(`Missing required child element: ${selector}`);
    return element;
};

export const state = {
    records: [] as RecordEntry[],
    eventId: "",
    query: "",
    teamCode: "",
    statusFilters: [] as AttendanceStatus[],
    statusFilterMode: "team" as "student" | "team",
    divisionFilters: [] as Division[],
    inspectionFilters: [] as InspectionStatus[],
    attendance: JSON.parse(localStorage.getItem("attendance-status") || "{}") as Record<string, AttendanceStatus>,
    inspection: JSON.parse(localStorage.getItem("inspection-status") || "{}") as Record<string, InspectionStatus>,
};
export const searchInput = query<HTMLInputElement>("#search");
export const clearButton = query<HTMLButtonElement>("#clear");
export const eventFilter = query<HTMLSelectElement>("#event-filter");
export const teamFilter = query<HTMLSelectElement>("#team-filter");
export const divisionFilter = query<HTMLElement>("#division-filter");
export const statusFilter = query<HTMLElement>("#status-filter");
export const inspectionFilter = query<HTMLElement>("#inspection-filter");
export const statusModeToggle = query<HTMLButtonElement>("#status-mode-toggle");
export const statusFilterLabel = query<HTMLElement>("#status-filter-label");
export const clearFiltersButton = query<HTMLButtonElement>("#clear-filters");
export const controlToolbar = query<HTMLElement>(".control-toolbar");
export const results = query<HTMLElement>("#results");
export const resultCount = query<HTMLElement>("#result-count");
export const statusElement = query<HTMLElement>("#status");
export const loadingProgress = query<HTMLProgressElement>("#loading-progress");
export const error = query<HTMLElement>("#error");
export const errorDialog = query<HTMLDialogElement>("#error-dialog");
export const errorDialogMessage = query<HTMLElement>("#error-dialog-message");
export const closeErrorButton = query<HTMLButtonElement>("#close-error");
export const resetButton = query<HTMLButtonElement>("#reset-attendance");
export const syncAttendanceButton = query<HTMLButtonElement>("#sync-attendance");
export const syncDialog = query<HTMLDialogElement>("#sync-dialog");
export const syncMethodDialog = query<HTMLDialogElement>("#sync-method-dialog");
export const liveSyncDialog = query<HTMLDialogElement>("#live-sync-dialog");
export const closeSyncMethodButton = query<HTMLButtonElement>("#close-sync-method");
export const chooseQrSyncButton = query<HTMLButtonElement>("#choose-qr-sync");
export const chooseLiveSyncButton = query<HTMLButtonElement>("#choose-live-sync");
export const closeLiveSyncButton = query<HTMLButtonElement>("#close-live-sync");
export const backQrSyncButton = query<HTMLButtonElement>("#back-qr-sync");
export const backLiveSyncButton = query<HTMLButtonElement>("#back-live-sync");
export const syncCanvas = query<HTMLCanvasElement>("#sync-qr");
export const syncVideo = query<HTMLVideoElement>("#sync-video");
export const liveSyncCanvas = query<HTMLCanvasElement>("#live-sync-qr");
export const liveSyncVideo = query<HTMLVideoElement>("#live-sync-video");
export const syncScanCanvas = document.createElement("canvas");
export const syncScanContext = syncScanCanvas.getContext("2d", { willReadFrequently: true });
export const liveSyncScanCanvas = document.createElement("canvas");
export const liveSyncScanContext = liveSyncScanCanvas.getContext("2d", { willReadFrequently: true });
export const syncMessage = query<HTMLElement>("#sync-message");
export const liveSyncMessage = query<HTMLElement>("#live-sync-message");
export const hostWebRTCButton = query<HTMLButtonElement>("#host-webrtc");
export const joinWebRTCButton = query<HTMLButtonElement>("#join-webrtc");
export const disconnectWebRTCButton = query<HTMLButtonElement>("#disconnect-webrtc");
export const regenerateLiveQrButton = query<HTMLButtonElement>("#regenerate-live-qr");
export const liveRoleInstructions = query<HTMLElement>("#live-role-instructions");
export const liveRoleTitle = query<HTMLElement>("#live-role-title");
export const liveRoleHelp = query<HTMLElement>("#live-role-help");
export const liveQrPanel = query<HTMLElement>("#live-qr-panel");
export const liveScannerPanel = query<HTMLElement>("#live-scanner-panel");
export const liveSyncStatus = query<HTMLElement>("#live-sync-status");
export const liveSyncSuccessDialog = query<HTMLDialogElement>("#live-sync-success-dialog");
export const liveSyncSuccessMessage = query<HTMLElement>("#live-sync-success-message");
export const closeLiveSyncSuccessButton = query<HTMLButtonElement>("#close-live-sync-success");
export const liveConflictPendingDialog = query<HTMLDialogElement>("#live-conflict-pending-dialog");
export const liveConflictPendingMessage = query<HTMLElement>("#live-conflict-pending-message");
export const liveSyncIndicator = query<HTMLElement>("#live-sync-indicator");
export const syncToast = query<HTMLElement>("#sync-toast");
export const syncToastMessage = query<HTMLElement>("#sync-toast-message");
export const cameraSelectWrap = query<HTMLElement>("#camera-select-wrap");
export const cameraSelect = query<HTMLSelectElement>("#camera-select");
export const liveCameraSelectWrap = query<HTMLElement>("#live-camera-select-wrap");
export const liveCameraSelect = query<HTMLSelectElement>("#live-camera-select");
export const liveSyncDeviceCount = query<HTMLElement>("#live-sync-device-count");
export const closeSyncButton = query<HTMLButtonElement>("#close-sync");
export const syncReviewDialog = query<HTMLDialogElement>("#sync-review-dialog");
export const syncReviewSummary = query<HTMLElement>("#sync-review-summary");
export const syncStatusTally = query<HTMLElement>("#sync-status-tally");
export const syncConflictHeading = query<HTMLElement>("#sync-conflict-heading");
export const syncConflictIcon = query<HTMLElement>("#sync-conflict-icon");
export const syncConflictLabelText = query<HTMLElement>("#sync-conflict-label-text");
export const syncReviewList = query<HTMLElement>("#sync-review-list");
export const closeSyncReviewButton = query<HTMLButtonElement>("#close-sync-review");
export const applySyncReviewButton = query<HTMLButtonElement>("#apply-sync-review");
export const toggleFiltersButton = query<HTMLButtonElement>("#toggle-filters");
export const toggleFiltersIcon = query<HTMLElement>("#toggle-filters-icon");
export const toggleTeamsButton = query<HTMLButtonElement>("#toggle-teams");
export const toggleTeamsIcon = query<HTMLElement>("#toggle-teams-icon");
export const teamTemplate = query<HTMLTemplateElement>("#team-template");
export const organisationTemplate = query<HTMLTemplateElement>("#organisation-template");
export const personTemplate = query<HTMLTemplateElement>("#person-template");
export const statusButtonTemplate = query<HTMLTemplateElement>("#status-button-template");
export const emptyTemplate = query<HTMLTemplateElement>("#empty-template");
export const teamOptionTemplate = query<HTMLTemplateElement>("#team-option-template");
export const syncStatusTallyTemplate = query<HTMLTemplateElement>("#sync-status-tally-template");
export const syncReviewTableTemplate = query<HTMLTemplateElement>("#sync-review-table-template");
export const syncReviewRowTemplate = query<HTMLTemplateElement>("#sync-review-row-template");
export const expandedTeams = new Set<string>();
export const teamAnimationDuration = 260;
export const attendanceStatuses: AttendanceStatus[] = [AttendanceStatus.UNPROCESSED, AttendanceStatus.PRESENT, AttendanceStatus.ABSENT, AttendanceStatus.FLAGGED];
export const isAttendanceStatus = (value: string): value is AttendanceStatus => attendanceStatuses.includes(value as AttendanceStatus);
export const eventListPath = "events.txt";
export const maxFetchAttempts = 3;
export const preloadedImages = new Map<string, string>();

export const statusCodes: Record<AttendanceStatus, number> = {
    [AttendanceStatus.UNPROCESSED]: 0,
    [AttendanceStatus.PRESENT]: 1,
    [AttendanceStatus.ABSENT]: 2,
    [AttendanceStatus.FLAGGED]: 3,
};
export const codeStatuses: AttendanceStatus[] = [
    AttendanceStatus.UNPROCESSED,
    AttendanceStatus.PRESENT,
    AttendanceStatus.ABSENT,
    AttendanceStatus.FLAGGED,
];
export const syncRuntime = {
    liveApplyingSnapshot: false,
};
export const setEvents = (value: EventDefinition[]): void => {
    events = value;
};
export let renderPreservingScrollCallback: () => void = () => { };
export let broadcastLiveSnapshotCallback: () => Promise<void> = async () => { };
export const setRenderPreservingScrollCallback = (callback: () => void): void => {
    renderPreservingScrollCallback = callback;
};
export const setBroadcastLiveSnapshotCallback = (callback: () => Promise<void>): void => {
    broadcastLiveSnapshotCallback = callback;
};
export function showErrorPopup(message: string): void {
    errorDialogMessage.textContent = message;
    if (!errorDialog.open) errorDialog.showModal();
}
export async function getDatasetHash(): Promise<string> {
    const canonical = JSON.stringify(state.records);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function attendanceKey(record: RecordEntry): string {
    return `${state.eventId}:${record.teamCode}:${record.division}:${record.name}`;
}
export function getAttendanceStatus(record: RecordEntry): AttendanceStatus {
    return state.attendance[attendanceKey(record)] || AttendanceStatus.UNPROCESSED;
}
export function inspectionKey(teamCode: string, division: Division): string {
    return `${state.eventId}:${teamCode}:${division}`;
}
export function isTeamInspected(teamCode: string, division: Division): boolean {
    return state.inspection[inspectionKey(teamCode, division)] === InspectionStatus.INSPECTED;
}
export function getTeamInspectionStatus(teamCode: string, division: Division): InspectionStatus {
    return state.inspection[inspectionKey(teamCode, division)] || InspectionStatus.NOT_INSPECTED;
}
export function saveInspection(): void {
    localStorage.setItem("inspection-status", JSON.stringify(state.inspection));
}
export function saveAttendance(): void {
    localStorage.setItem("attendance-status", JSON.stringify(state.attendance));
    if (!syncRuntime.liveApplyingSnapshot) void broadcastLiveSnapshotCallback();
}
