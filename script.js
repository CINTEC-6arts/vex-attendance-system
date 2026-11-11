const state = {
    records: [],
    query: "",
    teamCode: "",
    statusFilter: "",
    attendance: JSON.parse(localStorage.getItem("attendance-status") || "{}"),
};
const searchInput = document.querySelector("#search");
const clearButton = document.querySelector("#clear");
const teamFilter = document.querySelector("#team-filter");
const statusFilter = document.querySelector("#status-filter");
const clearFiltersButton = document.querySelector("#clear-filters");
const controlToolbar = document.querySelector(".control-toolbar");
const results = document.querySelector("#results");
const resultCount = document.querySelector("#result-count");
const status = document.querySelector("#status");
const error = document.querySelector("#error");
const dateLabel = document.querySelector("#attendance-date");
const resetButton = document.querySelector("#reset-attendance");
const toggleTeamsButton = document.querySelector("#toggle-teams");
const toggleTeamsIcon = document.querySelector("#toggle-teams-icon");
const teamTemplate = document.querySelector("#team-template");
const organisationTemplate = document.querySelector("#organisation-template");
const personTemplate = document.querySelector("#person-template");
const statusButtonTemplate = document.querySelector("#status-button-template");
const emptyTemplate = document.querySelector("#empty-template");
const teamOptionTemplate = document.querySelector("#team-option-template");
const expandedTeams = new Set();
const teamAnimationDuration = 260;

const today = new Date();
const todayKey = today.toISOString().slice(0, 10);
dateLabel.textContent = today.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

function attendanceKey(record) {
    return `${todayKey}:${record.teamCode}:${record.name}`;
}

function getAttendanceStatus(record) {
    return state.attendance[attendanceKey(record)] || "unprocessed";
}

function saveAttendance() {
    localStorage.setItem("attendance-status", JSON.stringify(state.attendance));
}

function display(value) {
    return value || "-";
}

function parseCSV(text) {
    const rows = [];
    let row = [];
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

    const headers = rows[0].map((header) => header.toLowerCase());
    const requiredHeaders = ["team_code", "organisation", "name", "dob", "school", "image"];
    const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
    if (missingHeaders.length) throw new Error(`CSV is missing columns: ${missingHeaders.join(", ")}.`);

    return rows.slice(1).map((cells, rowIndex) => {
        const record = Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
        if (!record.team_code || !record.name) throw new Error(`CSV row ${rowIndex + 2} is missing a team or name.`);
        return {
            teamCode: record.team_code,
            organisation: record.organisation,
            name: record.name,
            dob: record.dob,
            school: record.school,
            image: record.image,
        };
    });
}

async function loadRecords() {
    const response = await fetch("data.csv");
    if (!response.ok) throw new Error(`Could not load data.csv (${response.status} ${response.statusText}).`);
    state.records = parseCSV(await response.text());
}

function getTeamGradient(records) {
    const colors = {
        unprocessed: "#26334e",
        present: "#145c3d",
        absent: "#702b32",
        flagged: "#73500d",
    };
    const statuses = ["present", "absent", "flagged", "unprocessed"];
    const total = records.length;
    let position = 0;
    const stops = [];

    statuses.forEach((status) => {
        const percentage = records.filter((record) => getAttendanceStatus(record) === status).length / total * 100;
        if (percentage === 0) return;
        stops.push(`${colors[status]} ${position}%`, `${colors[status]} ${position + percentage}%`);
        position += percentage;
    });

    return `linear-gradient(90deg in oklab, ${stops.join(", ")})`;
}

function createStatusButtons(record, currentStatus) {
    const controls = statusButtonTemplate.content.firstElementChild.cloneNode(true);
    const labels = {
        unprocessed: "Unprocessed",
        present: "Present",
        absent: "Absent",
        flagged: "Flagged",
    };
    controls.querySelectorAll("[data-status]").forEach((button) => {
        const value = button.dataset.status;
        button.classList.toggle("selected", currentStatus === value);
        button.title = labels[value];
        button.setAttribute("aria-label", labels[value]);
        button.dataset.attendance = `${record.teamCode}:${record.name}`;
    });
    return controls;
}

function setTeamExpanded(group, expanded, animate = true) {
    const team = group.querySelector(".team-code").textContent;
    const heading = group.querySelector(".team-heading");
    const members = group.querySelector(".team-members");
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

function updateToggleTeamsButton() {
    const groups = [...results.querySelectorAll(".team-group")];
    const allExpanded = groups.length > 0 && groups.every((group) => !group.classList.contains("collapsed"));
    toggleTeamsIcon.textContent = allExpanded ? "unfold_less" : "unfold_more";
    toggleTeamsButton.setAttribute("aria-label", allExpanded ? "Collapse all teams" : "Expand all teams");
    toggleTeamsButton.title = allExpanded ? "Collapse all teams" : "Expand all teams";
}

function render() {
    results.querySelectorAll(".team-group").forEach((group) => {
        const team = group.querySelector(".team-code")?.textContent;
        const expanded = group.querySelector(".team-heading")?.getAttribute("aria-expanded") === "true";
        if (!team) return;
        if (expanded) {
            expandedTeams.add(team);
        } else {
            expandedTeams.delete(team);
        }
    });

    const query = state.query.toLowerCase();
    const searchFiltered = state.records.filter((record) => {
        const matchesQuery = !query || [record.teamCode, record.organisation, record.name]
            .some((value) => value.toLowerCase().includes(query));
        return matchesQuery && (!state.teamCode || record.teamCode === state.teamCode);
    });
    const matchingTeams = new Set(searchFiltered.filter((record) => !state.statusFilter || getAttendanceStatus(record) === state.statusFilter).map((record) => record.teamCode));
    const filtered = state.statusFilter ? state.records.filter((record) => matchingTeams.has(record.teamCode)) : searchFiltered;
    const filteredTeams = new Set(filtered.map((record) => record.teamCode));

    resultCount.replaceChildren();
    const takenAttendanceTeamCount = document.createElement("strong");
    takenAttendanceTeamCount.textContent = [...new Set(state.records.filter((record) => getAttendanceStatus(record) !== "unprocessed").map((record) => record.teamCode))].length;
    const totalTeamCount = document.createElement("strong");
    totalTeamCount.textContent = [...new Set(state.records.map((record) => record.teamCode))].length;
    const teamStatuses = state.records.reduce((teams, record) => {
        const team = teams.get(record.teamCode) || new Set();
        team.add(getAttendanceStatus(record));
        teams.set(record.teamCode, team);
        return teams;
    }, new Map());
    // A team with at least one present member is counted as present.
    const presentTeamCount = document.createElement("strong");
    presentTeamCount.textContent = [...teamStatuses.values()].filter((statuses) => statuses.has("present")).length;
    // An absent team must have no present members.
    const absentTeamCount = document.createElement("strong");
    absentTeamCount.textContent = [...teamStatuses.values()]
        .filter((statuses) => statuses.has("absent") && !statuses.has("present")).length;
    // A team with at least one flagged member is counted as flagged.
    const flaggedTeamCount = document.createElement("strong");
    flaggedTeamCount.textContent = [...teamStatuses.values()].filter((statuses) => statuses.has("flagged")).length;
    resultCount.append("Teams: ", takenAttendanceTeamCount, " / ", totalTeamCount, " taken attendance · ", presentTeamCount, " present · ", absentTeamCount, " absent  · ", flaggedTeamCount, " flagged");
    clearButton.classList.toggle("visible", Boolean(state.query));
    status.textContent = `${filteredTeams.size} shown${state.statusFilter ? ` · filtered for ${state.statusFilter}` : ""}`;
    results.replaceChildren();

    if (!filteredTeams.size) {
        results.append(emptyTemplate.content.cloneNode(true));
        return;
    }

    const groups = filtered.reduce((teams, record) => {
        if (!filteredTeams.has(record.teamCode)) return teams;
        (teams[record.teamCode] ||= []).push(record);
        return teams;
    }, {});
    const organisationGroups = Object.entries(groups).reduce((organisations, teamGroup) => {
        const organisation = teamGroup[1][0].organisation;
        (organisations[organisation] ||= []).push(teamGroup);
        return organisations;
    }, {});
    Object.entries(organisationGroups).sort(([a], [b]) => a.localeCompare(b)).forEach(([organisation, teams]) => {
        const organisationGroup = organisationTemplate.content.firstElementChild.cloneNode(true);
        organisationGroup.querySelector(".organisation-name").textContent = display(organisation);
        organisationGroup.querySelector(".organisation-total").textContent = `${teams.length} ${teams.length === 1 ? "team" : "teams"}`;
        const organisationTeams = organisationGroup.querySelector(".organisation-teams");

        teams.sort(([a], [b]) => a.localeCompare(b)).forEach(([team, records]) => {
        const group = teamTemplate.content.firstElementChild.cloneNode(true);
        const teamRecords = state.records.filter((record) => record.teamCode === team);
        group.style.setProperty("--team-gradient", getTeamGradient(teamRecords));
        group.querySelector(".team-code").textContent = display(team);
        group.querySelector(".team-total").textContent = `${records.length} ${records.length === 1 ? "person" : "people"}`;
        group.querySelectorAll("[data-team-status]").forEach((button) => { button.dataset.team = team; });
        const teamHeading = group.querySelector(".team-heading");
        const members = group.querySelector(".team-members");
        const membersContent = group.querySelector(".team-members-content");
        teamHeading.setAttribute("aria-controls", `team-members-${team}`);
        members.id = `team-members-${team}`;
        const isExpanded = expandedTeams.has(team);
        group.classList.toggle("collapsed", !isExpanded);
        teamHeading.setAttribute("aria-expanded", String(isExpanded));
        teamHeading.addEventListener("click", (event) => {
            if (event.target.closest("[data-team-status]")) return;
            setTeamExpanded(group, group.classList.contains("collapsed"));
            updateToggleTeamsButton();
        });
        teamHeading.addEventListener("keydown", (event) => {
            if (event.target.closest("[data-team-status]")) return;
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            teamHeading.click();
        });

        records.forEach((record) => {
            const person = personTemplate.content.firstElementChild.cloneNode(true);
            const currentStatus = getAttendanceStatus(record);
            person.classList.add(currentStatus);
            person.querySelector(".person-image").src = `images/${encodeURIComponent(record.image)}`;
            person.querySelector(".person-image").alt = display(record.name);
            person.querySelector(".person-name").textContent = display(record.name);
            person.querySelector(".person-meta").textContent = `${display(record.school)} · ${display(record.dob)}`;
            person.querySelector(".status-placeholder").replaceWith(createStatusButtons(record, currentStatus));
            membersContent.append(person);
        });
        organisationTeams.append(group);
        if (isExpanded) {
            members.style.transition = "none";
            members.style.maxHeight = `${members.scrollHeight}px`;
            void members.offsetHeight;
            requestAnimationFrame(() => { members.style.transition = ""; });
        }
        });
        results.append(organisationGroup);
    });
    updateToggleTeamsButton();
}

function renderPreservingScroll() {
    const scrollPosition = window.scrollY;
    render();
    requestAnimationFrame(() => {
        window.scrollTo({ top: scrollPosition, left: 0, behavior: "instant" });
    });
}

function populateTeams() {
    [...new Set(state.records.map((record) => record.teamCode).filter(Boolean))]
        .sort()
        .forEach((team) => {
            const option = teamOptionTemplate.content.firstElementChild.cloneNode(true);
            option.value = team;
            option.textContent = team;
            teamFilter.append(option);
        });
}

searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    render();
});
clearButton.addEventListener("click", () => {
    searchInput.value = "";
    state.query = "";
    searchInput.focus();
    render();
});
teamFilter.addEventListener("change", (event) => {
    state.teamCode = event.target.value;
    render();
});
statusFilter.addEventListener("change", (event) => {
    state.statusFilter = event.target.value;
    render();
});
clearFiltersButton.addEventListener("click", () => {
    searchInput.value = "";
    teamFilter.value = "";
    statusFilter.value = "";
    state.query = "";
    state.teamCode = "";
    state.statusFilter = "";
    render();
});
toggleTeamsButton.addEventListener("click", () => {
    const groups = [...results.querySelectorAll(".team-group")];
    if (!groups.length) return;

    const allExpanded = groups.every((group) => !group.classList.contains("collapsed"));
    const toolbarBottom = controlToolbar.getBoundingClientRect().bottom;
    const anchor = groups.find((group) => {
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
    const teamButton = event.target.closest("[data-team-status]");
    if (teamButton) {
        state.records
            .filter((record) => record.teamCode === teamButton.dataset.team)
            .forEach((record) => { state.attendance[attendanceKey(record)] = teamButton.dataset.teamStatus; });
        saveAttendance();
        renderPreservingScroll();
        return;
    }
    const button = event.target.closest("[data-status]");
    if (!button) return;
    const [team, name] = button.dataset.attendance.split(":");
    const record = state.records.find((item) => item.teamCode === team && item.name === name);
    if (!record) return;
    state.attendance[attendanceKey(record)] = button.dataset.status;
    saveAttendance();
    renderPreservingScroll();
});
resetButton.addEventListener("click", () => {
    if (!window.confirm("Delete all saved attendance data for today? This cannot be undone.")) return;
    state.records.forEach((record) => { delete state.attendance[attendanceKey(record)]; });
    saveAttendance();
    render();
});

status.textContent = "Loading records...";
loadRecords()
    .then(() => {
        populateTeams();
        status.textContent = `${state.records.length} total entries`;
        render();
    })
    .catch((loadError) => {
        error.textContent = `Unable to load records: ${loadError.message}`;
        error.hidden = false;
        status.textContent = "Unable to load records";
    });
