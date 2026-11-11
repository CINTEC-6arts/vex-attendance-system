const state = {
    records: [
        { team: "1234A", teamName: "team1", name: "apple", dob: "jan2026", school: "CUHK", image: "file1.png" },
        { team: "1234A", teamName: "team1", name: "avacado", dob: "jan2026", school: "CUHK", image: "file1.png" },
        { team: "4567B", teamName: "team2", name: "banana", dob: "feb2025", school: "HKU", image: "file2.png" },
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
const results = document.querySelector("#results");
const resultCount = document.querySelector("#result-count");
const status = document.querySelector("#status");
const dateLabel = document.querySelector("#attendance-date");
const resetButton = document.querySelector("#reset-attendance");
const teamTemplate = document.querySelector("#team-template");
const personTemplate = document.querySelector("#person-template");
const statusButtonTemplate = document.querySelector("#status-button-template");
const emptyTemplate = document.querySelector("#empty-template");
const teamOptionTemplate = document.querySelector("#team-option-template");

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

function render() {
    const query = state.query.toLowerCase();
    const searchFiltered = state.records.filter((record) => {
        const matchesQuery = !query || [record.team, record.name].some((value) => value.toLowerCase().includes(query));
        return matchesQuery && (!state.team || record.team === state.team);
    });
    const matchingTeams = new Set(searchFiltered.filter((record) => !state.statusFilter || getAttendanceStatus(record) === state.statusFilter).map((record) => record.team));
    const filtered = state.statusFilter ? state.records.filter((record) => matchingTeams.has(record.team)) : searchFiltered;
    const presentCount = state.records.filter((record) => getAttendanceStatus(record) === "present").length;
    const absentCount = state.records.filter((record) => getAttendanceStatus(record) === "absent").length;

    resultCount.replaceChildren();
    const present = document.createElement("strong");
    present.textContent = presentCount;
    const absent = document.createElement("strong");
    absent.textContent = absentCount;
    resultCount.append(present, " present · ", absent, " absent");
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
        group.querySelector(".team-name").textContent = display(records[0].teamName);
        group.querySelector(".team-code").textContent = display(team);
        group.querySelector(".team-total").textContent = `${records.length} ${records.length === 1 ? "person" : "people"}`;
        group.querySelectorAll("[data-team-status]").forEach((button) => { button.dataset.team = team; });

        const members = group.querySelector(".team-members");
        records.forEach((record) => {
            const person = personTemplate.content.firstElementChild.cloneNode(true);
            const currentStatus = getAttendanceStatus(record);
            person.classList.add(currentStatus);
            person.querySelector(".person-image").src = `images/${encodeURIComponent(record.image)}`;
            person.querySelector(".person-image").alt = display(record.name);
            person.querySelector(".person-name").textContent = display(record.name);
            person.querySelector(".person-meta").textContent = `${display(record.school)} · ${display(record.dob)}`;
            person.querySelector(".status-placeholder").replaceWith(createStatusButtons(record, currentStatus));
            members.append(person);
        });
        results.append(group);
    });
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
