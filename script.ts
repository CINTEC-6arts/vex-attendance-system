enum AttendanceStatus {
    UNPROCESSED = "unprocessed",
    PRESENT = "present",
    ABSENT = "absent",
    FLAGGED = "flagged"
}
enum Division {
    ES = "ES",
    MS = "MS"
}
type RecordEntry = {
    teamCode: string;
    division: Division;
    organisation: string;
    name: string;
    dob: string;
    school: string;
    image: string;
};
type EventDefinition = {
    id: string;
    label: string;
};

let events: EventDefinition[] = [];

const query = <T extends Element>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing required element: ${selector}`);
    return element;
};
const child = <T extends Element>(parent: Element, selector: string): T => {
    const element = parent.querySelector<T>(selector);
    if (!element) throw new Error(`Missing required child element: ${selector}`);
    return element;
};

const state = {
    records: [] as RecordEntry[],
    eventId: "",
    query: "",
    teamCode: "",
    statusFilter: "",
    attendance: JSON.parse(localStorage.getItem("attendance-status") || "{}") as Record<string, AttendanceStatus>,
};
const searchInput = query<HTMLInputElement>("#search");
const clearButton = query<HTMLButtonElement>("#clear");
const eventFilter = query<HTMLSelectElement>("#event-filter");
const teamFilter = query<HTMLSelectElement>("#team-filter");
const divisionFilter = query<HTMLSelectElement>("#division-filter");
const statusFilter = query<HTMLSelectElement>("#status-filter");
const clearFiltersButton = query<HTMLButtonElement>("#clear-filters");
const controlToolbar = query<HTMLElement>(".control-toolbar");
const results = query<HTMLElement>("#results");
const resultCount = query<HTMLElement>("#result-count");
const statusElement = query<HTMLElement>("#status");
const loadingProgress = query<HTMLProgressElement>("#loading-progress");
const error = query<HTMLElement>("#error");
const resetButton = query<HTMLButtonElement>("#reset-attendance");
const toggleTeamsButton = query<HTMLButtonElement>("#toggle-teams");
const toggleTeamsIcon = query<HTMLElement>("#toggle-teams-icon");
const teamTemplate = query<HTMLTemplateElement>("#team-template");
const organisationTemplate = query<HTMLTemplateElement>("#organisation-template");
const personTemplate = query<HTMLTemplateElement>("#person-template");
const statusButtonTemplate = query<HTMLTemplateElement>("#status-button-template");
const emptyTemplate = query<HTMLTemplateElement>("#empty-template");
const teamOptionTemplate = query<HTMLTemplateElement>("#team-option-template");
const expandedTeams = new Set<string>();
const teamAnimationDuration = 260;
const attendanceStatuses: AttendanceStatus[] = [AttendanceStatus.UNPROCESSED, AttendanceStatus.PRESENT, AttendanceStatus.ABSENT, AttendanceStatus.FLAGGED];
const isAttendanceStatus = (value: string): value is AttendanceStatus => attendanceStatuses.includes(value as AttendanceStatus);
const eventListPath = "events.txt";
const maxFetchAttempts = 3;
const preloadedImages = new Map<string, string>();

async function fetchWithRetry(url: string): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxFetchAttempts; attempt += 1) {
        try {
            const response = await fetch(url);
            if (response.ok) return response;
            lastError = new Error(`${response.status} ${response.statusText}`);
        } catch (error) {
            lastError = error;
        }
        if (attempt < maxFetchAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        }
    }
    throw new Error(`Failed to fetch ${url} after ${maxFetchAttempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function getAssetPaths(eventId: string) {
    return {
        data: `assets/${eventId}/data.csv`,
        images: `assets/${eventId}/images/`,
    };
}

function updateStickyOffsets() {
    const toolbarHeight = controlToolbar.getBoundingClientRect().height;
    const organisationHeading = results.querySelector(".organisation-heading");
    const organisationHeadingHeight = organisationHeading
        ? organisationHeading.getBoundingClientRect().height
        : 42;
    document.documentElement.style.setProperty("--sticky-toolbar-height", `${toolbarHeight + 20}px`);
    document.documentElement.style.setProperty("--organisation-heading-height", `${organisationHeadingHeight}px`);
}

const stickyOffsetObserver = new ResizeObserver(updateStickyOffsets);
stickyOffsetObserver.observe(controlToolbar);

function attendanceKey(record) {
    return `${state.eventId}:${record.teamCode}:${record.division}:${record.name}`;
}

function getAttendanceStatus(record) {
    return state.attendance[attendanceKey(record)] || AttendanceStatus.UNPROCESSED;
}

function saveAttendance() {
    localStorage.setItem("attendance-status", JSON.stringify(state.attendance));
}

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

function parseCSV(text: string): RecordEntry[] {
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
        if (division !== Division.ES && division !== Division.MS) {
            throw new Error(`CSV row ${rowIndex + 2} has an invalid division. Expected ES or MS.`);
        }
        return {
            teamCode: record.team_code,
            division,
            organisation: record.organisation,
            name: record.name,
            dob: record.dob,
            school: record.school,
            image: record.image,
        };
    });
}

async function loadRecords() {
    const assetPaths = getAssetPaths(state.eventId);
    loadingProgress.hidden = false;
    loadingProgress.value = 0;
    loadingProgress.max = 1;
    const response = await fetchWithRetry(assetPaths.data);
    const records = parseCSV(await response.text());
    const imageUrls = [...new Set(records.map((record) => `${assetPaths.images}${encodeURIComponent(record.image)}`))];
    const failedImages: string[] = [];
    loadingProgress.value = 1;
    loadingProgress.max = imageUrls.length + 1;
    await Promise.all(imageUrls.map(async (url) => {
        try {
            const imageResponse = await fetchWithRetry(url);
            preloadedImages.set(url, URL.createObjectURL(await imageResponse.blob()));
        } catch {
            failedImages.push(url);
        } finally {
            loadingProgress.value += 1;
        }
    }));
    loadingProgress.hidden = true;
    if (failedImages.length) {
        error.textContent = `${failedImages.length} image${failedImages.length === 1 ? "" : "s"} could not be preloaded; they will load normally as needed.`;
        error.hidden = false;
    }
    state.records = records;
}

function getTeamGradient(records: RecordEntry[], width: number | null = null): string {
    const colors = {
        unprocessed: "#26334e",
        present: "#145c3d",
        absent: "#702b32",
        flagged: "#73500d",
    };
    const statuses = ["present", "absent", "flagged", "unprocessed"];
    const total = records.length;
    let position = 0;
    const stops: string[] = [];

    statuses.forEach((status) => {
        const percentage = records.filter((record) => getAttendanceStatus(record) === status).length / total * 100;
        if (percentage === 0) return;
        const start = width === null ? `${position}%` : `${position / 100 * width}px`;
        const end = width === null ? `${position + percentage}%` : `${(position + percentage) / 100 * width}px`;
        stops.push(`${colors[status]} ${start}`, `${colors[status]} ${end}`);
        position += percentage;
    });

    return `linear-gradient(90deg in oklab, ${stops.join(", ")})`;
}

function updateAbsoluteTeamGradients(): void {
    results.querySelectorAll(".team-group").forEach((group) => {
        const width = group.getBoundingClientRect().width;
        const [teamCode, division] = (group as HTMLElement).dataset.teamKey?.split("|") || [];
        const teamRecords = state.records.filter((record) => record.teamCode === teamCode && record.division === division);
        (group as HTMLElement).style.setProperty("--team-gradient", getTeamGradient(teamRecords, width));
        (group as HTMLElement).style.setProperty("--team-gradient-width", `${width}px`);
    });
}

function createStatusButtons(record: RecordEntry, currentStatus: AttendanceStatus): HTMLElement {
    const controls = statusButtonTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
    const labels = {
        unprocessed: "Unprocessed",
        present: "Present",
        absent: "Absent",
        flagged: "Flagged",
    };
    controls.querySelectorAll<HTMLButtonElement>("[data-status]").forEach((button) => {
        const value = button.dataset.status as AttendanceStatus;
        button.classList.toggle("selected", currentStatus === value);
        button.title = labels[value];
        button.setAttribute("aria-label", labels[value]);
        button.dataset.attendance = `${record.teamCode}:${record.division}:${record.name}`;
    });
    return controls;
}

function setTeamExpanded(group: HTMLElement, expanded: boolean, animate = true): boolean {
    const team = group.dataset.teamKey || "";
    const heading = child<HTMLElement>(group, ".team-heading");
    const members = child<HTMLElement>(group, ".team-members");
    const currentlyExpanded = !group.classList.contains("collapsed");

    if (currentlyExpanded === expanded) return false;

    group.classList.toggle("collapsed", !expanded);
    heading.setAttribute("aria-expanded", String(expanded));
    if (expanded) {
        expandedTeams.add(team);
    } else {
        expandedTeams.delete(team);
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

function updateToggleTeamsButton(): void {
    const groups = [...results.querySelectorAll(".team-group")];
    const allExpanded = groups.length > 0 && groups.every((group) => !group.classList.contains("collapsed"));
    toggleTeamsIcon.textContent = allExpanded ? "unfold_less" : "unfold_more";
    toggleTeamsButton.setAttribute("aria-label", allExpanded ? "Collapse all teams" : "Expand all teams");
    toggleTeamsButton.title = allExpanded ? "Collapse all teams" : "Expand all teams";
}

function render(): void {
    const query = state.query.toLowerCase();
    const searchFiltered = state.records.filter((record) => {
        const matchesQuery = !query || [record.teamCode, record.division, record.organisation, record.name]
            .some((value) => value.toLowerCase().includes(query));
        return matchesQuery
            && (!state.teamCode || record.teamCode === state.teamCode)
            && (!divisionFilter.value || record.division === divisionFilter.value);
    });
    const matchingTeams = new Set(searchFiltered.filter((record) => !state.statusFilter || getAttendanceStatus(record) === state.statusFilter).map((record) => record.teamCode));
    const filtered = state.statusFilter ? state.records.filter((record) => matchingTeams.has(record.teamCode)) : searchFiltered;
    const filteredTeams = new Set(filtered.map((record) => record.teamCode));

    resultCount.replaceChildren();
    const takenAttendanceTeamCount = document.createElement("strong");
    takenAttendanceTeamCount.textContent = String([...new Set(state.records.filter((record) => getAttendanceStatus(record) !== "unprocessed").map((record) => record.teamCode))].length);
    const totalTeamCount = document.createElement("strong");
    totalTeamCount.textContent = String([...new Set(state.records.map((record) => record.teamCode))].length);
    const teamStatuses = state.records.reduce((teams, record) => {
        const team = teams.get(record.teamCode) || new Set();
        team.add(getAttendanceStatus(record));
        teams.set(record.teamCode, team);
        return teams;
    }, new Map());
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
    resultCount.append("Teams: ", takenAttendanceTeamCount, " / ", totalTeamCount, " taken attendance · ", presentTeamCount, " present · ", absentTeamCount, " absent  · ", flaggedTeamCount, " flagged");
    clearButton.classList.toggle("visible", Boolean(state.query));
    statusElement.textContent = `${filteredTeams.size} shown${state.statusFilter ? ` · filtered for ${state.statusFilter}` : ""}`;
    results.replaceChildren();

    if (!filteredTeams.size) {
        results.append(emptyTemplate.content.cloneNode(true));
        updateStickyOffsets();
        return;
    }

    const groups = filtered.reduce<Record<string, RecordEntry[]>>((teams, record) => {
        const groupKey = `${record.teamCode}|${record.division}`;
        if (!filteredTeams.has(record.teamCode)) return teams;
        (teams[groupKey] ||= []).push(record);
        return teams;
    }, {});
    const organisationGroups = Object.entries(groups).reduce<Record<string, [string, RecordEntry[]][]>>((organisations, teamGroup) => {
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
            const organisationGroup = organisationTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
            highlightText(child<HTMLElement>(organisationGroup, ".organisation-name"), organisation, query);
            child<HTMLElement>(organisationGroup, ".organisation-total").textContent = `${teams.length} ${teams.length === 1 ? "team" : "teams"}`;
            const organisationTeams = child<HTMLElement>(organisationGroup, ".organisation-teams");

            teams.sort(([a], [b]) => a.localeCompare(b)).forEach(([groupKey, records]) => {
                const [team, division] = groupKey.split("|");
                const group = teamTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
                const teamRecords = state.records.filter((record) => record.teamCode === team && record.division === division);
                group.style.setProperty("--team-gradient", getTeamGradient(teamRecords));
                highlightText(child<HTMLElement>(group, ".team-code"), `${team} · ${division}`, query);
                child<HTMLElement>(group, ".team-total").textContent = `${records.length} ${records.length === 1 ? "person" : "people"}`;
                group.querySelectorAll<HTMLButtonElement>("[data-team-status]").forEach((button) => {
                    button.dataset.team = team;
                    button.dataset.division = division;
                });
                const teamHeading = child<HTMLElement>(group, ".team-heading");
                const members = child<HTMLElement>(group, ".team-members");
                const membersContent = child<HTMLElement>(group, ".team-members-content");
                const groupId = `${team}-${division}`;
                group.dataset.teamKey = groupKey;
                teamHeading.setAttribute("aria-controls", `team-members-${groupId}`);
                members.id = `team-members-${groupId}`;
                const nameMatchesQuery = Boolean(query) && records.some((record) => record.name.toLowerCase().includes(query));
                const isExpanded = expandedTeams.has(groupKey) || nameMatchesQuery;
                group.classList.toggle("collapsed", !isExpanded);
                teamHeading.setAttribute("aria-expanded", String(isExpanded));
                teamHeading.addEventListener("click", (event) => {
                    if ((event.target as Element).closest("[data-team-status]")) return;
                    setTeamExpanded(group, group.classList.contains("collapsed"));
                    updateToggleTeamsButton();
                });
                teamHeading.addEventListener("keydown", (event) => {
                    if ((event.target as Element).closest("[data-team-status]")) return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    teamHeading.click();
                });

                records.forEach((record) => {
                    const person = personTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
                    const currentStatus = getAttendanceStatus(record);
                    person.classList.add(currentStatus);
                    const imageUrl = `${getAssetPaths(state.eventId).images}${encodeURIComponent(record.image)}`;
                    const displayImageUrl = preloadedImages.get(imageUrl) || imageUrl;
                    const imageFrame = child<HTMLElement>(person, ".person-image-frame");
                    imageFrame.style.setProperty("--person-image-url", `url("${displayImageUrl}")`);
                    child<HTMLImageElement>(imageFrame, ".person-image").src = displayImageUrl;
                    child<HTMLImageElement>(person, ".person-image").alt = display(record.name);
                    person.dataset.teamCode = record.teamCode;
                    person.dataset.division = record.division;
                    person.dataset.personName = record.name;
                    highlightText(person.querySelector(".person-name"), record.name, query);
                    child<HTMLElement>(person, ".person-meta").textContent = `${display(record.school)} · ${display(record.dob)}`;
                    child<HTMLElement>(person, ".status-placeholder").replaceWith(createStatusButtons(record, currentStatus));
                    membersContent.append(person);
                });
                organisationTeams.append(group);
            });
            results.append(organisationGroup);
            organisationGroup.querySelectorAll<HTMLElement>(".team-group").forEach((group) => {
                if (group.classList.contains("collapsed")) return;
                const members = child<HTMLElement>(group, ".team-members");
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
    teamFilter.replaceChildren(new Option("All teams", ""));
    [...new Set(state.records.map((record) => record.teamCode).filter(Boolean))]
        .sort()
        .forEach((team) => {
            const option = teamOptionTemplate.content.firstElementChild!.cloneNode(true) as HTMLOptionElement;
            option.value = team;
            option.textContent = team;
            teamFilter.append(option);
        });
}

function populateEvents() {
    eventFilter.replaceChildren(new Option("Select event...", ""));
    events.forEach((event) => {
        eventFilter.append(new Option(event.label, event.id));
    });
    eventFilter.value = state.eventId;
}

async function loadEvents() {
    const response = await fetchWithRetry(eventListPath);
    const eventIds = (await response.text())
        .split(/\r?\n/)
        .map((eventId) => eventId.trim())
        .filter(Boolean);
    if (!eventIds.length) throw new Error("No event folders were detected during the build.");
    events = eventIds.map((id) => ({
        id,
        label: id.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    }));
    state.eventId = "";
}

function populateDivisions() {
    divisionFilter.replaceChildren(new Option("All divisions", ""));
    ["ES", "MS"].forEach((division) => {
        const option = document.createElement("option");
        option.value = division;
        option.textContent = division;
        divisionFilter.append(option);
    });
}

function clearEventFilters() {
    searchInput.value = "";
    teamFilter.value = "";
    divisionFilter.value = "";
    statusFilter.value = "";
    state.query = "";
    state.teamCode = "";
    state.statusFilter = "";
    expandedTeams.clear();
}

async function switchEvent(eventId: string) {
    if (eventId && !events.some((event) => event.id === eventId)) return;
    state.eventId = eventId;
    clearEventFilters();
    results.replaceChildren();
    error.hidden = true;
    if (!eventId) {
        state.records = [];
        populateTeams();
        eventFilter.value = "";
        statusElement.textContent = "Select an event to load records";
        render();
        return;
    }
    statusElement.textContent = "Loading event records...";
    try {
        await loadRecords();
        populateTeams();
        statusElement.textContent = `${state.records.length} total entries`;
        render();
    } catch (loadError) {
        loadingProgress.hidden = true;
        error.textContent = `Unable to load event records: ${loadError instanceof Error ? loadError.message : String(loadError)}`;
        error.hidden = false;
        statusElement.textContent = "Unable to load event records";
    }
}

searchInput.addEventListener("input", (event) => {
    state.query = (event.target as HTMLInputElement).value.trim();
    renderPreservingScroll();
});
eventFilter.addEventListener("change", (event) => {
    const nextEventId = (event.target as HTMLSelectElement).value;
    if (nextEventId === state.eventId) return;
    const nextEvent = events.find((item) => item.id === nextEventId);
    const nextEventLabel = nextEvent?.label || "Select event...";
    const confirmed = window.confirm(`Switch to ${nextEventLabel}? Attendance is tracked separately for each event.`);
    if (!confirmed) {
        eventFilter.value = state.eventId;
        return;
    }
    void switchEvent(nextEventId);
});
clearButton.addEventListener("click", () => {
    searchInput.value = "";
    state.query = "";
    searchInput.focus();
    renderPreservingScroll();
});
teamFilter.addEventListener("change", (event) => {
    state.teamCode = (event.target as HTMLSelectElement).value;
    renderPreservingScroll();
});
statusFilter.addEventListener("change", (event) => {
    state.statusFilter = (event.target as HTMLSelectElement).value;
    renderPreservingScroll();
});
divisionFilter.addEventListener("change", () => {
    renderPreservingScroll();
});
clearFiltersButton.addEventListener("click", () => {
    searchInput.value = "";
    teamFilter.value = "";
    divisionFilter.value = "";
    statusFilter.value = "";
    state.query = "";
    state.teamCode = "";
    state.statusFilter = "";
    renderPreservingScroll();
});
toggleTeamsButton.addEventListener("click", () => {
    const groups = [...results.querySelectorAll<HTMLElement>(".team-group")];
    if (!groups.length) return;

    const allExpanded = groups.every((group) => !group.classList.contains("collapsed"));
    const toolbarBottom = controlToolbar.getBoundingClientRect().bottom;
    const anchor = groups.find((group) => {
        const rect = group.getBoundingClientRect();
        return rect.top >= toolbarBottom && rect.top < window.innerHeight;
    }) || groups.find((group) => {
        const rect = group.getBoundingClientRect();
        return rect.bottom > toolbarBottom && rect.top < window.innerHeight;
    });
    const anchorOffset = anchor
        ? anchor.getBoundingClientRect().top - toolbarBottom
        : 0;
    const targetExpanded = !allExpanded;

    groups.forEach((group) => { setTeamExpanded(group, targetExpanded); });
    updateToggleTeamsButton();

    if (!anchor) return;
    const keepAnchor = () => {
        const currentTop = anchor.getBoundingClientRect().top;
        const currentToolbarBottom = controlToolbar.getBoundingClientRect().bottom;
        window.scrollBy(0, currentTop - currentToolbarBottom - anchorOffset);
    };
    const start = performance.now();
    const maintainAnchor = (now) => {
        keepAnchor();
        if (now - start < teamAnimationDuration) {
            requestAnimationFrame(maintainAnchor);
        }
    };
    requestAnimationFrame(maintainAnchor);
});
results.addEventListener("click", (event) => {
    const teamButton = (event.target as Element).closest<HTMLButtonElement>("[data-team-status]");
    if (teamButton) {
        state.records
            .filter((record) => record.teamCode === teamButton.dataset.team && record.division === teamButton.dataset.division)
            .forEach((record) => {
                const status = teamButton.dataset.teamStatus;
                if (status && isAttendanceStatus(status)) state.attendance[attendanceKey(record)] = status;
            });
        saveAttendance();
        renderPreservingScroll();
        return;
    }
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-status]");
    if (button) {
        const [team, division, name] = button.dataset.attendance.split(":");
        const record = state.records.find((item) => item.teamCode === team && item.division === division && item.name === name);
        if (!record) return;
        if (!button.dataset.status || !isAttendanceStatus(button.dataset.status)) return;
        state.attendance[attendanceKey(record)] = button.dataset.status;
        saveAttendance();
        renderPreservingScroll();
        return;
    }

    const person = (event.target as Element).closest<HTMLElement>(".person-row");
    if (!person) return;
    const record = state.records.find((item) => item.teamCode === person.dataset.teamCode
        && item.division === person.dataset.division
        && item.name === person.dataset.personName);
    if (!record) return;
    const currentStatus = getAttendanceStatus(record);
    const nextStatus = attendanceStatuses[(attendanceStatuses.indexOf(currentStatus) + 1) % attendanceStatuses.length];
    state.attendance[attendanceKey(record)] = nextStatus;
    saveAttendance();
    renderPreservingScroll();
});
resetButton.addEventListener("click", () => {
    if (!window.confirm("Delete all saved attendance data for today? This cannot be undone.")) return;
    state.records.forEach((record) => { delete state.attendance[attendanceKey(record)]; });
    saveAttendance();
    render();
});

statusElement.textContent = "Loading events...";
populateDivisions();
loadEvents()
    .then(() => {
        populateEvents();
        return switchEvent(state.eventId);
    })
    .catch((loadError) => {
        error.textContent = `Unable to load events: ${loadError instanceof Error ? loadError.message : String(loadError)}`;
        error.hidden = false;
        statusElement.textContent = "Unable to load events";
    });
