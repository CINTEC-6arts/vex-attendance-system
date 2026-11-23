import * as core from "./core";

async function fetchWithRetry(url: string): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= core.maxFetchAttempts; attempt += 1) {
        try {
            const response = await fetch(url);
            if (response.ok) return response;
            lastError = new Error(`${response.status} ${response.statusText}`);
        } catch (error) {
            lastError = error;
        }
        if (attempt < core.maxFetchAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        }
    }
    throw new Error(`Failed to fetch ${url} after ${core.maxFetchAttempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function getAssetPaths(eventId: string) {
    return {
        data: `assets/${eventId}/data.csv`,
        images: `assets/${eventId}/images/`,
    };
}

function updateStickyOffsets() {
    const toolbarHeight = core.controlToolbar.getBoundingClientRect().height;
    const organisationHeading = core.results.querySelector(".organisation-heading");
    const organisationHeadingHeight = organisationHeading
        ? organisationHeading.getBoundingClientRect().height
        : 42;
    document.documentElement.style.setProperty("--sticky-toolbar-height", `${toolbarHeight + 20}px`);
    document.documentElement.style.setProperty("--organisation-heading-height", `${organisationHeadingHeight}px`);
}

const stickyOffsetObserver = new ResizeObserver(updateStickyOffsets);
stickyOffsetObserver.observe(core.controlToolbar);

function getResizeAnchor(): { element: HTMLElement; top: number } | null {
    const candidates = [...core.results.querySelectorAll<HTMLElement>(".team-group")]
        .map((group) => ({ group, rect: group.getBoundingClientRect() }));
    const anchor = candidates.find(({ rect }) => rect.top <= 0 && rect.bottom > 0)
        || candidates.find(({ rect }) => rect.top >= 0 && rect.top < window.innerHeight);
    return anchor ? { element: anchor.group, top: anchor.rect.top } : null;
}

function recalculateLayoutPreservingScroll(): void {
    const scrollPosition = window.scrollY;
    const anchor = getResizeAnchor();
    core.results.querySelectorAll<HTMLElement>(".team-group:not(.collapsed) .team-members").forEach((members) => {
        const transition = members.style.transition;
        members.style.transition = "none";
        members.style.maxHeight = "none";
        members.style.maxHeight = `${members.scrollHeight}px`;
        members.style.transition = transition;
    });
    updateAbsoluteTeamGradients();
    updateStickyOffsets();
    requestAnimationFrame(() => {
        const correction = anchor && anchor.element.isConnected
            ? anchor.element.getBoundingClientRect().top - anchor.top
            : 0;
        window.scrollTo({
            top: Math.max(0, scrollPosition + correction),
            left: 0,
            behavior: "auto",
        });
    });
}

let resizeFrame = 0;
let resizeTimeout = 0;
export const scheduleLayoutRecalculation = (): void => {
    window.clearTimeout(resizeTimeout);
    cancelAnimationFrame(resizeFrame);
    resizeTimeout = window.setTimeout(() => {
        resizeFrame = requestAnimationFrame(recalculateLayoutPreservingScroll);
    }, 120);
};
window.addEventListener("resize", scheduleLayoutRecalculation, { passive: true });



function display(value) {
    return value || "-";
}

function highlightText(element, value, query) {
    element.replaceChildren();
    const text = display(value);
    if (!query) {
        element.append(text);
        return;
    }

    const normalizedText = text.toLowerCase();
    const normalizedQuery = query.toLowerCase();
    let start = 0;
    let matchIndex = normalizedText.indexOf(normalizedQuery, start);
    while (matchIndex !== -1) {
        element.append(
            text.slice(start, matchIndex),
            Object.assign(document.createElement("mark"), {
                textContent: text.slice(matchIndex, matchIndex + query.length),
            }),
        );
        start = matchIndex + query.length;
        matchIndex = normalizedText.indexOf(normalizedQuery, start);
    }
    element.append(text.slice(start));
}

function parseCSV(text: string): core.RecordEntry[] {
    const rows: string[][] = [];
    let row: string[] = [];
    let value = "";
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        const nextCharacter = text[index + 1];
        if (character === '"' && quoted && nextCharacter === '"') {
            value += '"';
            index += 1;
        } else if (character === '"') {
            quoted = !quoted;
        } else if (character === "," && !quoted) {
            row.push(value.trim());
            value = "";
        } else if ((character === "\n" || character === "\r") && !quoted) {
            if (character === "\r" && nextCharacter === "\n") index += 1;
            row.push(value.trim());
            if (row.some(Boolean)) rows.push(row);
            row = [];
            value = "";
        } else {
            value += character;
        }
    }

    row.push(value.trim());
    if (row.some(Boolean)) rows.push(row);
    if (quoted) throw new Error("CSV contains an unclosed quoted field.");
    if (rows.length < 2) throw new Error("CSV does not contain any records.");

    const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").toLowerCase());
    const requiredHeaders = ["team_code", "division", "organisation", "name", "dob", "school", "image"];
    const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
    if (missingHeaders.length) throw new Error(`CSV is missing columns: ${missingHeaders.join(", ")}.`);

    return rows.slice(1).map((cells, rowIndex) => {
        const record = Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""])) as Record<string, string>;
        if (!record.team_code || !record.name) throw new Error(`CSV row ${rowIndex + 2} is missing a team or name.`);
        const division = record.division.toUpperCase();
        if (!(Object.values(core.Division) as string[]).includes(division)) {
            throw new Error(`CSV row ${rowIndex + 2} has an invalid division. Expected ES or MS.`);
        }
        return {
            teamCode: record.team_code,
            division: division as core.Division,
            organisation: record.organisation,
            name: record.name,
            dob: record.dob,
            school: record.school,
            image: record.image,
        };
    });
}

async function loadRecords() {
    const assetPaths = getAssetPaths(core.state.eventId);
    core.loadingProgress.hidden = false;
    core.loadingProgress.value = 0;
    core.loadingProgress.max = 1;
    const response = await fetchWithRetry(assetPaths.data);
    const records = parseCSV(await response.text());
    const imageUrls = [...new Set(records.map((record) => `${assetPaths.images}${encodeURIComponent(record.image)}`))];
    const failedImages: string[] = [];
    core.loadingProgress.value = 1;
    core.loadingProgress.max = imageUrls.length + 1;
    await Promise.all(imageUrls.map(async (url) => {
        try {
            const imageResponse = await fetchWithRetry(url);
            core.preloadedImages.set(url, URL.createObjectURL(await imageResponse.blob()));
        } catch {
            failedImages.push(url);
        } finally {
            core.loadingProgress.value += 1;
        }
    }));
    core.loadingProgress.hidden = true;
    if (failedImages.length) {
        core.showErrorPopup(`${failedImages.length} image${failedImages.length === 1 ? "" : "s"} could not be preloaded; they will load normally as needed.`);
        core.error.hidden = false;
    }
    core.state.records = records;
}

function getTeamGradient(records: core.RecordEntry[], width: number | null = null): string {
    const colors: Record<core.AttendanceStatus, string> = {
        [core.AttendanceStatus.UNPROCESSED]: "#26334e",
        [core.AttendanceStatus.PRESENT]: "#145c3d",
        [core.AttendanceStatus.ABSENT]: "#702b32",
        [core.AttendanceStatus.FLAGGED]: "#73500d",
    };
    const statuses = [core.AttendanceStatus.PRESENT, core.AttendanceStatus.ABSENT, core.AttendanceStatus.FLAGGED, core.AttendanceStatus.UNPROCESSED];
    const total = records.length;
    let position = 0;
    const stops: string[] = [];

    statuses.forEach((status) => {
        const percentage = records.filter((record) => core.getAttendanceStatus(record) === status).length / total * 100;
        if (percentage === 0) return;
        const start = width === null ? `${position}%` : `${position / 100 * width}px`;
        const end = width === null ? `${position + percentage}%` : `${(position + percentage) / 100 * width}px`;
        stops.push(`${colors[status]} ${start}`, `${colors[status]} ${end}`);
        position += percentage;
    });

    return `linear-gradient(90deg in oklab, ${stops.join(", ")})`;
}

function updateAbsoluteTeamGradients(): void {
    core.results.querySelectorAll(".team-group").forEach((group) => {
        const width = group.getBoundingClientRect().width;
        const [teamCode, division] = (group as HTMLElement).dataset.teamKey?.split("|") || [];
        const teamRecords = core.state.records.filter((record) => record.teamCode === teamCode && record.division === division);
        (group as HTMLElement).style.setProperty("--team-gradient", getTeamGradient(teamRecords, width));
        (group as HTMLElement).style.setProperty("--team-gradient-width", `${width}px`);
    });
}

function createStatusButtons(record: core.RecordEntry, currentStatus: core.AttendanceStatus): HTMLElement {
    const controls = core.statusButtonTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
    const labels: Record<core.AttendanceStatus, string> = Object.values(core.AttendanceStatus).reduce((acc, status) => {
        acc[status] = status.charAt(0).toUpperCase() + status.slice(1);
        return acc;
    }, {} as Record<core.AttendanceStatus, string>);
    controls.querySelectorAll<HTMLButtonElement>("[data-status]").forEach((button) => {
        const value = button.dataset.status as core.AttendanceStatus;
        button.classList.toggle("selected", currentStatus === value);
        button.title = labels[value];
        button.setAttribute("aria-label", labels[value]);
        button.dataset.attendance = `${record.teamCode}:${record.division}:${record.name}`;
    });
    return controls;
}

export function setTeamExpanded(group: HTMLElement, expanded: boolean, animate = true): boolean {
    const team = group.dataset.teamKey || "";
    const heading = core.child<HTMLElement>(group, ".team-heading");
    const members = core.child<HTMLElement>(group, ".team-members");
    const currentlyExpanded = !group.classList.contains("collapsed");

    if (currentlyExpanded === expanded) return false;

    group.classList.toggle("collapsed", !expanded);
    heading.setAttribute("aria-expanded", String(expanded));
    if (expanded) {
        core.expandedTeams.add(team);
    } else {
        core.expandedTeams.delete(team);
    }

    if (!animate) {
        members.style.maxHeight = expanded ? `${members.scrollHeight}px` : "0px";
        return true;
    }

    if (expanded) {
        members.style.maxHeight = "0px";
        void members.offsetHeight;
        requestAnimationFrame(() => { members.style.maxHeight = `${members.scrollHeight}px`; });
    } else {
        members.style.maxHeight = `${members.scrollHeight}px`;
        void members.offsetHeight;
        requestAnimationFrame(() => { members.style.maxHeight = "0px"; });
    }
    return true;
}

export function updateToggleTeamsButton(): void {
    const groups = [...core.results.querySelectorAll(".team-group")];
    const allExpanded = groups.length > 0 && groups.every((group) => !group.classList.contains("collapsed"));
    core.toggleTeamsIcon.textContent = allExpanded ? "collapse_content" : "expand_content";
    core.toggleTeamsButton.setAttribute("aria-label", allExpanded ? "Collapse all teams" : "Expand all teams");
    core.toggleTeamsButton.title = allExpanded ? "Collapse all teams" : "Expand all teams";
}

function updateClearFiltersButton(): void {
    core.clearFiltersButton.disabled = !core.teamFilter.value
        && !core.divisionFilter.querySelector("input:checked")
        && !core.statusFilter.querySelector("input:checked")
        && !core.inspectionFilter.querySelector("input:checked");
}

function getTeamStatusFlags(teamRecords: core.RecordEntry[]): Set<core.AttendanceStatus> {
    const statuses = new Set<core.AttendanceStatus>();
    if (teamRecords.length && teamRecords.every((record) =>
        core.getAttendanceStatus(record) === core.AttendanceStatus.UNPROCESSED
    )) {
        statuses.add(core.AttendanceStatus.UNPROCESSED);
    }
    if (teamRecords.some((record) =>
        core.getAttendanceStatus(record) === core.AttendanceStatus.PRESENT
    )) {
        statuses.add(core.AttendanceStatus.PRESENT);
    }
    if (teamRecords.length && teamRecords.every((record) =>
        core.getAttendanceStatus(record) === core.AttendanceStatus.ABSENT
    )) {
        statuses.add(core.AttendanceStatus.ABSENT);
    }
    if (teamRecords.some((record) =>
        core.getAttendanceStatus(record) === core.AttendanceStatus.FLAGGED
    )) {
        statuses.add(core.AttendanceStatus.FLAGGED);
    }
    return statuses;
}

function appendHeadingTally(container: HTMLElement, status: string, count: number, label: string, icon: string): void {
    const tally = document.createElement("span");
    tally.className = `heading-tally ${status}`;
    tally.setAttribute("aria-label", `${count} ${label}`);
    const countElement = document.createElement("strong");
    countElement.textContent = String(count);
    const iconElement = document.createElement("span");
    iconElement.className = "material-symbols-outlined";
    iconElement.setAttribute("aria-hidden", "true");
    iconElement.title = label;
    iconElement.textContent = icon;
    tally.append(countElement, iconElement);
    container.append(tally);
}

export function render(): void {
    const query = core.state.query.toLowerCase();
    const selectedDivisions = [...core.divisionFilter.querySelectorAll<HTMLInputElement>("input:checked")]
        .map((input) => input.value);
    const selectedStatuses = core.state.statusFilters;
    const selectedInspectionFilters = core.state.inspectionFilters;
    const searchFiltered = core.state.records.filter((record) => {
        const matchesQuery = !query || [record.teamCode, record.division, record.organisation, record.name]
            .some((value) => value.toLowerCase().includes(query));
        const matchesInspection = !selectedInspectionFilters.length
            || selectedInspectionFilters.includes(core.getTeamInspectionStatus(record.teamCode, record.division));
        return matchesQuery
            && (!core.state.teamCode || record.teamCode === core.state.teamCode)
            && (!selectedDivisions.length || selectedDivisions.includes(record.division))
            && matchesInspection;
    });
    const matchingTeams = new Set(searchFiltered
        .filter((record) => {
            if (!selectedStatuses.length) return true;
            if (core.state.statusFilterMode === "team") {
                const teamRecords = searchFiltered.filter((item) =>
                    item.teamCode === record.teamCode && (!selectedDivisions.length || selectedDivisions.includes(item.division))
                );
                const teamFlags = getTeamStatusFlags(teamRecords);
                return selectedStatuses.some((status) => teamFlags.has(status));
            }
            return selectedStatuses.includes(core.getAttendanceStatus(record));
        })
        .map((record) => record.teamCode));
    const filtered = selectedStatuses.length
        ? core.state.records.filter((record) => matchingTeams.has(record.teamCode)
            && (!selectedDivisions.length || selectedDivisions.includes(record.division)))
        : searchFiltered;
    const filteredTeams = new Set(filtered.map((record) => record.teamCode));

    core.resultCount.replaceChildren();
    const takenAttendanceTeamCount = document.createElement("strong");
    takenAttendanceTeamCount.textContent = String([...new Set(core.state.records.filter((record) => core.getAttendanceStatus(record) !== "unprocessed").map((record) => record.teamCode))].length);
    const totalTeamCount = document.createElement("strong");
    totalTeamCount.textContent = String([...new Set(core.state.records.map((record) => record.teamCode))].length);
    const teamStatuses = core.state.records.reduce((teams, record) => {
        const team = teams.get(record.teamCode) || new Set();
        team.add(core.getAttendanceStatus(record));
        teams.set(record.teamCode, team);
        return teams;
    }, new Map());
    // A team with all members unprocessed is counted as unprocessed.
    const unprocessedTeamCount = document.createElement("strong");
    unprocessedTeamCount.textContent = String([...teamStatuses.values()].filter((statuses) => statuses.has("unprocessed") && !statuses.has("present") && !statuses.has("absent") && !statuses.has("flagged")).length);
    // A team with at least one present member is counted as present.
    const presentTeamCount = document.createElement("strong");
    presentTeamCount.textContent = String([...teamStatuses.values()].filter((statuses) => statuses.has("present")).length);
    // An absent team must have no present members.
    const absentTeamCount = document.createElement("strong");
    absentTeamCount.textContent = String([...teamStatuses.values()]
        .filter((statuses) => statuses.has("absent") && !statuses.has("present")).length);
    // A team with at least one flagged member is counted as flagged.
    const flaggedTeamCount = document.createElement("strong");
    flaggedTeamCount.textContent = String([...teamStatuses.values()].filter((statuses) => statuses.has("flagged")).length);
    const inspectedTeamCount = document.createElement("strong");
    const inspectedTeamKeys = [...new Set(core.state.records.map((record) => `${record.teamCode}|${record.division}`))]
        .filter((teamKey) => {
            const [team, division] = teamKey.split("|");
            return core.isTeamInspected(team, division as core.Division);
        });
    inspectedTeamCount.textContent = String(inspectedTeamKeys.length);
    const partiallyInspectedTeamCount = document.createElement("strong");
    const partiallyInspectedTeamKeys = [...new Set(core.state.records.map((record) => `${record.teamCode}|${record.division}`))]
        .filter((teamKey) => {
            const [team, division] = teamKey.split("|");
            return core.getTeamInspectionStatus(team, division as core.Division) === core.InspectionStatus.PARTIALLY_INSPECTED;
        });
    partiallyInspectedTeamCount.textContent = String(partiallyInspectedTeamKeys.length);
    const appendStatusTally = (count: HTMLElement, status: core.AttendanceStatus, icon: string): void => {
        const tally = document.createElement("span");
        tally.className = `attendance-tally ${status}`;
        tally.setAttribute("aria-label", `${count.textContent} ${status} teams`);
        const statusIcon = document.createElement("span");
        statusIcon.className = "material-symbols-outlined tally-icon";
        statusIcon.setAttribute("aria-hidden", "true");
        statusIcon.title = `${count.textContent} ${status} teams`;
        statusIcon.textContent = icon;
        tally.append(count, statusIcon);
        core.resultCount.append(tally);
    };
    core.resultCount.append(totalTeamCount, " teams total · ");
    appendStatusTally(unprocessedTeamCount, core.AttendanceStatus.UNPROCESSED, "question_mark");
    core.resultCount.append(" · ");
    appendStatusTally(presentTeamCount, core.AttendanceStatus.PRESENT, "check");
    core.resultCount.append(" · ");
    appendStatusTally(absentTeamCount, core.AttendanceStatus.ABSENT, "close");
    core.resultCount.append(" · ");
    appendStatusTally(flaggedTeamCount, core.AttendanceStatus.FLAGGED, "flag");
    core.resultCount.append(" · ");
    const inspectionTally = document.createElement("span");
    inspectionTally.className = "attendance-tally inspected";
    inspectionTally.setAttribute("aria-label", `${inspectedTeamCount.textContent} teams inspected`);
    const inspectionIcon = document.createElement("span");
    inspectionIcon.className = "material-symbols-outlined tally-icon";
    inspectionIcon.setAttribute("aria-hidden", "true");
    inspectionIcon.title = `${inspectedTeamCount.textContent} teams inspected`;
    inspectionIcon.textContent = "fact_check";
    inspectionTally.append(inspectedTeamCount, inspectionIcon);
    core.resultCount.append(inspectionTally);
    core.resultCount.append(" · ");
    const partialInspectionTally = document.createElement("span");
    partialInspectionTally.className = "attendance-tally partially-inspected";
    partialInspectionTally.setAttribute("aria-label", `${partiallyInspectedTeamCount.textContent} teams partially inspected`);
    const partialInspectionIcon = document.createElement("span");
    partialInspectionIcon.className = "material-symbols-outlined tally-icon";
    partialInspectionIcon.setAttribute("aria-hidden", "true");
    partialInspectionIcon.title = `${partiallyInspectedTeamCount.textContent} teams partially inspected`;
    partialInspectionIcon.textContent = "stroke_partial";
    partialInspectionTally.append(partiallyInspectedTeamCount, partialInspectionIcon);
    core.resultCount.append(partialInspectionTally);
    core.clearButton.classList.toggle("visible", Boolean(core.state.query));
    updateClearFiltersButton();
    const isFiltered = Boolean(query)
        || Boolean(core.state.teamCode)
        || (selectedDivisions.length != 0 && selectedDivisions.length != Object.values(core.Division).length)
        || (selectedStatuses.length != 0 && selectedStatuses.length != Object.values(core.AttendanceStatus).length)
        || (selectedInspectionFilters.length != 0 && selectedInspectionFilters.length != Object.values(core.InspectionStatus).length);
    core.statusElement.textContent = `${filteredTeams.size} / ${totalTeamCount.textContent} shown${isFiltered ? " · filtered" : ""}`;
    core.results.replaceChildren();

    if (!filteredTeams.size) {
        core.results.append(core.emptyTemplate.content.cloneNode(true));
        updateStickyOffsets();
        return;
    }

    const groups = filtered.reduce<Record<string, core.RecordEntry[]>>((teams, record) => {
        const groupKey = `${record.teamCode}|${record.division}`;
        if (!filteredTeams.has(record.teamCode)) return teams;
        (teams[groupKey] ||= []).push(record);
        return teams;
    }, {});
    const organisationGroups = Object.entries(groups).reduce<Record<string, [string, core.RecordEntry[]][]>>((organisations, teamGroup) => {
        const organisation = teamGroup[1][0].organisation;
        (organisations[organisation] ||= []).push(teamGroup);
        return organisations;
    }, {});
    Object.entries(organisationGroups)
        .sort(([, teamsA], [, teamsB]) => {
            const firstTeamA = teamsA.map(([team]) => team).sort()[0];
            const firstTeamB = teamsB.map(([team]) => team).sort()[0];
            return firstTeamA.localeCompare(firstTeamB);
        })
        .forEach(([organisation, teams]) => {
            const organisationGroup = core.organisationTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
            highlightText(core.child<HTMLElement>(organisationGroup, ".organisation-name"), organisation, query);
            core.child<HTMLElement>(organisationGroup, ".organisation-total").textContent = `${teams.length} ${teams.length === 1 ? "team" : "teams"}`;
            const organisationTallies = core.child<HTMLElement>(organisationGroup, ".organisation-tallies");
            const organisationStatusCounts = { unprocessed: 0, present: 0, absent: 0, flagged: 0 };
            teams.forEach(([groupKey]) => {
                const [team, division] = groupKey.split("|");
                const teamRecords = core.state.records.filter((record) => record.teamCode === team && record.division === division);
                getTeamStatusFlags(teamRecords).forEach((status) => {
                    organisationStatusCounts[status] += 1;
                });
            });
            appendHeadingTally(organisationTallies, core.AttendanceStatus.UNPROCESSED, organisationStatusCounts.unprocessed, `${core.AttendanceStatus.UNPROCESSED} teams`, "question_mark");
            appendHeadingTally(organisationTallies, core.AttendanceStatus.PRESENT, organisationStatusCounts.present, `${core.AttendanceStatus.PRESENT} teams`, "check");
            appendHeadingTally(organisationTallies, core.AttendanceStatus.ABSENT, organisationStatusCounts.absent, `${core.AttendanceStatus.ABSENT} teams`, "close");
            appendHeadingTally(organisationTallies, core.AttendanceStatus.FLAGGED, organisationStatusCounts.flagged, `${core.AttendanceStatus.FLAGGED} teams`, "flag");
            const inspectedTeamCount = teams.filter(([groupKey]) => {
                const [team, division] = groupKey.split("|");
                return core.isTeamInspected(team, division as core.Division);
            }).length;
            appendHeadingTally(organisationTallies, core.InspectionStatus.INSPECTED, inspectedTeamCount, `${core.InspectionStatus.INSPECTED} teams`, "fact_check");
            const partiallyInspectedTeamCount = teams.filter(([groupKey]) => {
                const [team, division] = groupKey.split("|");
                return core.getTeamInspectionStatus(team, division as core.Division) === core.InspectionStatus.PARTIALLY_INSPECTED;
            }).length;
            appendHeadingTally(organisationTallies, core.InspectionStatus.PARTIALLY_INSPECTED, partiallyInspectedTeamCount, "partially inspected teams", "stroke_partial");
            organisationGroup.style.setProperty("--inspection-percentage", `${teams.length ? inspectedTeamCount / teams.length * 100 : 0}%`);
            const organisationTeams = core.child<HTMLElement>(organisationGroup, ".organisation-teams");

            teams.sort(([a], [b]) => a.localeCompare(b)).forEach(([groupKey, records]) => {
                const [team, division] = groupKey.split("|");
                const group = core.teamTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
                const teamRecords = core.state.records.filter((record) => record.teamCode === team && record.division === division);
                group.style.setProperty("--team-gradient", getTeamGradient(teamRecords));
                highlightText(core.child<HTMLElement>(group, ".team-code"), `${team} · ${division}`, query);
                core.child<HTMLElement>(group, ".team-total").textContent = `${records.length} ${records.length === 1 ? "person" : "people"}`;
                const inspectionStatus = core.getTeamInspectionStatus(team, division as core.Division);
                group.classList.toggle("inspected", inspectionStatus === core.InspectionStatus.INSPECTED);
                group.classList.toggle("partially-inspected", inspectionStatus === core.InspectionStatus.PARTIALLY_INSPECTED);
                const inspectionButton = core.child<HTMLButtonElement>(group, "[data-team-inspection]");
                inspectionButton.dataset.team = team;
                inspectionButton.dataset.division = division;
                inspectionButton.dataset.inspectionStatus = inspectionStatus;
                inspectionButton.setAttribute("aria-pressed", String(inspectionStatus !== core.InspectionStatus.NOT_INSPECTED));
                inspectionButton.title = inspectionStatus === core.InspectionStatus.INSPECTED
                    ? "Mark team as partially inspected"
                    : inspectionStatus === core.InspectionStatus.PARTIALLY_INSPECTED
                        ? "Mark team as not inspected"
                        : "Mark team as passed inspection";
                inspectionButton.setAttribute("aria-label", inspectionButton.title);
                core.child<HTMLElement>(inspectionButton, ".material-symbols-outlined").textContent = inspectionStatus === core.InspectionStatus.INSPECTED
                    ? "fact_check"
                    : inspectionStatus === core.InspectionStatus.PARTIALLY_INSPECTED
                        ? "stroke_partial"
                        : "cancel_presentation";
                group.querySelectorAll<HTMLButtonElement>("[data-team-status]").forEach((button) => {
                    button.dataset.team = team;
                    button.dataset.division = division;
                    const status = button.dataset.teamStatus as core.AttendanceStatus;
                    const badge = core.child<HTMLElement>(button, ".team-tally-badge");
                    badge.textContent = String(teamRecords.filter((record) =>
                        core.getAttendanceStatus(record) === status
                    ).length);
                });
                const teamHeading = core.child<HTMLElement>(group, ".team-heading");
                const members = core.child<HTMLElement>(group, ".team-members");
                const membersContent = core.child<HTMLElement>(group, ".team-members-content");
                const groupId = `${team}-${division}`;
                group.dataset.teamKey = groupKey;
                teamHeading.setAttribute("aria-controls", `team-members-${groupId}`);
                members.id = `team-members-${groupId}`;
                const nameMatchesQuery = Boolean(query) && records.some((record) => record.name.toLowerCase().includes(query));
                const isExpanded = core.expandedTeams.has(groupKey) || nameMatchesQuery;
                group.classList.toggle("collapsed", !isExpanded);
                teamHeading.setAttribute("aria-expanded", String(isExpanded));
                teamHeading.addEventListener("click", (event) => {
                    if ((event.target as Element).closest("[data-team-status], [data-team-inspection]")) return;
                    setTeamExpanded(group, group.classList.contains("collapsed"));
                    updateToggleTeamsButton();
                });
                teamHeading.addEventListener("keydown", (event) => {
                    if ((event.target as Element).closest("[data-team-status], [data-team-inspection]")) return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    teamHeading.click();
                });

                records.forEach((record) => {
                    const person = core.personTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
                    const currentStatus = core.getAttendanceStatus(record);
                    person.classList.add(currentStatus);
                    const imageUrl = `${getAssetPaths(core.state.eventId).images}${encodeURIComponent(record.image)}`;
                    const displayImageUrl = core.preloadedImages.get(imageUrl) || imageUrl;
                    const imageFrame = core.child<HTMLElement>(person, ".person-image-frame");
                    imageFrame.style.setProperty("--person-image-url", `url("${displayImageUrl}")`);
                    core.child<HTMLImageElement>(imageFrame, ".person-image").src = displayImageUrl;
                    core.child<HTMLImageElement>(person, ".person-image").alt = display(record.name);
                    person.dataset.teamCode = record.teamCode;
                    person.dataset.division = record.division;
                    person.dataset.personName = record.name;
                    highlightText(person.querySelector(".person-name"), record.name, query);
                    core.child<HTMLElement>(person, ".person-meta").textContent = `${display(record.school)} · ${display(record.dob)}`;
                    core.child<HTMLElement>(person, ".status-placeholder").replaceWith(createStatusButtons(record, currentStatus));
                    membersContent.append(person);
                });
                organisationTeams.append(group);
            });
            core.results.append(organisationGroup);
            organisationGroup.querySelectorAll<HTMLElement>(".team-group").forEach((group) => {
                if (group.classList.contains("collapsed")) return;
                const members = core.child<HTMLElement>(group, ".team-members");
                members.style.transition = "none";
                members.style.maxHeight = `${members.scrollHeight}px`;
                void members.offsetHeight;
                requestAnimationFrame(() => { members.style.transition = ""; });
            });
        });
    updateToggleTeamsButton();
    updateAbsoluteTeamGradients();
    updateStickyOffsets();
}

function renderPreservingScroll() {
    const scrollPosition = window.scrollY;
    render();
    requestAnimationFrame(() => {
        window.scrollTo({ top: scrollPosition, left: 0, behavior: "instant" });
    });
}

function populateTeams() {
    core.teamFilter.replaceChildren(new Option("All teams", ""));
    [...new Set(core.state.records.map((record) => record.teamCode).filter(Boolean))]
        .sort()
        .forEach((team) => {
            const option = core.teamOptionTemplate.content.firstElementChild!.cloneNode(true) as HTMLOptionElement;
            option.value = team;
            option.textContent = team;
            core.teamFilter.append(option);
        });
}

function populateEvents() {
    core.eventFilter.replaceChildren(new Option("Select event...", ""));
    core.events.forEach((event) => {
        core.eventFilter.append(new Option(event.label, event.id));
    });
    core.eventFilter.value = core.state.eventId;
}

async function loadEvents() {
    const response = await fetchWithRetry(core.eventListPath);
    const eventIds = (await response.text())
        .split(/\r?\n/)
        .map((eventId) => eventId.trim())
        .filter(Boolean);
    if (!eventIds.length) throw new Error("No event folders were detected during the build.");
    core.setEvents(eventIds.map((id) => ({
        id,
        label: id.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    })));

    core.state.eventId = "";
}

function clearEventFilters() {
    core.searchInput.value = "";
    core.teamFilter.value = "";
    core.divisionFilter.querySelectorAll<HTMLInputElement>("input").forEach((input) => { input.checked = false; });
    core.statusFilter.querySelectorAll<HTMLInputElement>("input").forEach((input) => { input.checked = false; });
    core.inspectionFilter.querySelectorAll<HTMLInputElement>("input").forEach((input) => { input.checked = false; });
    core.state.query = "";
    core.state.teamCode = "";
    core.state.statusFilters = [];
    core.state.inspectionFilters = [];
    core.expandedTeams.clear();
}

export async function switchEvent(eventId: string) {
    if (eventId && !core.events.some((event) => event.id === eventId)) return;
    core.state.eventId = eventId;
    if (eventId) {
        core.eventFilter.querySelector('option[value=""]')?.remove();
    }
    clearEventFilters();
    core.results.replaceChildren();
    core.error.hidden = true;
    if (!eventId) {
        core.state.records = [];
        populateTeams();
        core.eventFilter.value = "";
        core.statusElement.textContent = "Select an event to load records";
        render();
        return;
    }
    core.statusElement.textContent = "Loading event records...";
    try {
        await loadRecords();
        populateTeams();
        core.statusElement.textContent = `${core.state.records.length} total entries`;
        render();
    } catch (loadError) {
        core.loadingProgress.hidden = true;
        core.showErrorPopup(`Unable to load event records: ${loadError instanceof Error ? loadError.message : String(loadError)}`);
        core.statusElement.textContent = "Unable to load event records";
    }
}

core.setRenderPreservingScrollCallback(renderPreservingScroll);


export function initApp(): void {
    core.statusElement.textContent = "Loading core.events...";
    void loadEvents()
        .then(() => {
            populateEvents();
            return switchEvent(core.state.eventId);
        })
        .catch((loadError) => {
            core.showErrorPopup(`Unable to load core.events: ${loadError instanceof Error ? loadError.message : String(loadError)}`);
            core.statusElement.textContent = "Unable to load core.events";
        });
}
