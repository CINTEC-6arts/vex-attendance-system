import * as app from "./app";
import * as core from "./core";

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

core.statusModeToggle.addEventListener("click", () => {
    core.state.statusFilterMode = core.state.statusFilterMode === "student" ? "team" : "student";
    const teamMode = core.state.statusFilterMode === "team";
    core.statusModeToggle.setAttribute("aria-pressed", String(teamMode));
    core.statusModeToggle.setAttribute("aria-label", teamMode ? "Switch to student status filter" : "Switch to team status filter");
    core.statusModeToggle.title = teamMode ? "Switch to student status filter" : "Switch to team status filter";
    core.statusFilterLabel.textContent = teamMode ? "Team Status" : "Student Status";
    const modeIcon = core.child<HTMLElement>(core.statusModeToggle, ".material-symbols-outlined");
    modeIcon.textContent = teamMode ? "groups" : "person";
    modeIcon.title = teamMode ? "Team Status" : "Student Status";
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
