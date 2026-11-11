const state = {
    records: [
        { team: "1234A", teamName: "team1", name: "apple", dob: "jan2026", school: "CUHK", image: "file1.png" },
        { team: "1234A", teamName: "team1", name: "avacado", dob: "jan2026", school: "CUHK", image: "file1.png" },
        { team: "4567B", teamName: "team2", name: "banana", dob: "feb2025", school: "HKU", image: "file2.png" },
        { team: "8910C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "8910C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "8911C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "8910C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "8910C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "8920C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "8910C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "8A10C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "8940C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "8910C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "8950C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "8910C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "890SA", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "8960AC", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "8960C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "8960C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "89AS0C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "89610C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "89620C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "891140C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "123960C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "8910C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
        { team: "8910C", teamName: "team3", name: "cherry", dob: "mar2024", school: "PolyU", image: "file3.png" },
    ],
    query: "",
    team: "",
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
const dateLabel = document.querySelector("#attendance-date");
const resetButton = document.querySelector("#reset-attendance");
const toggleTeamsButton = document.querySelector("#toggle-teams");
const toggleTeamsIcon = document.querySelector("#toggle-teams-icon");
const teamTemplate = document.querySelector("#team-template");
const personTemplate = document.querySelector("#person-template");
const statusButtonTemplate = document.querySelector("#status-button-template");
const emptyTemplate = document.querySelector("#empty-template");
const teamOptionTemplate = document.querySelector("#team-option-template");
const expandedTeams = new Set();
const teamAnimationDuration = 260;

const today = new Date();
const todayKey = today.toISOString().slice(0, 10);
dateLabel.textContent = today.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

function attendanceKey(record) {
    return `${todayKey}:${record.team}:${record.name}`;
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

function getTeamGradient(records) {
    const colors = {
        unprocessed: "#26334e",
        present: "#145c3d",
        absent: "#702b32",
        flagged: "#73500d",
    };
    const statuses = ["unprocessed", "present", "absent", "flagged"];
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
        button.dataset.attendance = `${record.team}:${record.name}`;
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
        const matchesQuery = !query || [record.team, record.name].some((value) => value.toLowerCase().includes(query));
        return matchesQuery && (!state.team || record.team === state.team);
    });
    const matchingTeams = new Set(searchFiltered.filter((record) => !state.statusFilter || getAttendanceStatus(record) === state.statusFilter).map((record) => record.team));
    const filtered = state.statusFilter ? state.records.filter((record) => matchingTeams.has(record.team)) : searchFiltered;
    const presentCount = state.records.filter((record) => getAttendanceStatus(record) === "present").length;
    const absentCount = state.records.filter((record) => getAttendanceStatus(record) === "absent").length;
    const flaggedCount = state.records.filter((record) => getAttendanceStatus(record) === "flagged").length;

    resultCount.replaceChildren();
    const present = document.createElement("strong");
    present.textContent = presentCount;
    const absent = document.createElement("strong");
    absent.textContent = absentCount;
    const flagged = document.createElement("strong");
    flagged.textContent = flaggedCount;
    resultCount.append(present, " present · ", absent, " absent  · ", flagged, " flagged");
    clearButton.classList.toggle("visible", Boolean(state.query));
    status.textContent = `${filtered.length} shown${state.statusFilter ? " · full teams displayed" : ""}`;
    results.replaceChildren();

    if (!filtered.length) {
        results.append(emptyTemplate.content.cloneNode(true));
        return;
    }

    const groups = filtered.reduce((result, record) => {
        (result[record.team] ||= []).push(record);
        return result;
    }, {});
    Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).forEach(([team, records]) => {
        const group = teamTemplate.content.firstElementChild.cloneNode(true);
        const teamRecords = state.records.filter((record) => record.team === team);
        group.style.setProperty("--team-gradient", getTeamGradient(teamRecords));
        group.querySelector(".team-name").textContent = display(records[0].teamName);
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
        results.append(group);
        if (isExpanded) {
            members.style.transition = "none";
            members.style.maxHeight = `${members.scrollHeight}px`;
            void members.offsetHeight;
            requestAnimationFrame(() => { members.style.transition = ""; });
        }
    });
    updateToggleTeamsButton();
}

function populateTeams() {
    [...new Set(state.records.map((record) => record.team).filter(Boolean))]
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
    state.team = event.target.value;
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
    state.team = "";
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
            .filter((record) => record.team === teamButton.dataset.team)
            .forEach((record) => { state.attendance[attendanceKey(record)] = teamButton.dataset.teamStatus; });
        saveAttendance();
        render();
        return;
    }
    const button = event.target.closest("[data-status]");
    if (!button) return;
    const [team, name] = button.dataset.attendance.split(":");
    const record = state.records.find((item) => item.team === team && item.name === name);
    if (!record) return;
    state.attendance[attendanceKey(record)] = button.dataset.status;
    saveAttendance();
    render();
});
resetButton.addEventListener("click", () => {
    state.records.forEach((record) => { delete state.attendance[attendanceKey(record)]; });
    saveAttendance();
    render();
});

populateTeams();
status.textContent = `${state.records.length} total entries`;
render();
