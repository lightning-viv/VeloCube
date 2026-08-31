/**
 * Speedcubing Timer with Session Management
 */

// ==================================================
// CONSTANTS & CONFIGURATION
// ==================================================
const HOLD_DURATION_MS = 500;
const SCRAMBLE_LENGTH = 20;
const LOCAL_STORAGE_SESSIONS_KEY = "speedcube_sessions_v1";
const LOCAL_STORAGE_ACTIVE_SESSION_KEY = "speedcube_active_session_id_v1";

const TIMER_STATES = Object.freeze({
  IDLE: "IDLE",
  HOLDING: "HOLDING",
  READY: "READY",
  RUNNING: "RUNNING",
  STOPPED: "STOPPED"
});

const INPUT_SOURCES = Object.freeze({
  NONE: "NONE",
  KEYBOARD: "KEYBOARD",
  TOUCH: "TOUCH",
  ESP32: "ESP32"
});

const MOVE_AXIS_MAP = Object.freeze({
  R: "X", L: "X",
  U: "Y", D: "Y",
  F: "Z", B: "Z"
});

const FACES = ["R", "L", "U", "D", "F", "B"];
const MODIFIERS = ["", "'", "2"];

// ==================================================
// APPLICATION STATE
// ==================================================
const state = {
  currentTimerState: TIMER_STATES.IDLE,
  activeInputSource: INPUT_SOURCES.NONE,
  timerStartPerformanceTimestamp: 0,
  currentSolveElapsedTimeMs: 0,
  animationFrameRequestId: null,
  holdTimeoutId: null,
  currentScrambleText: "",
  sessions: [],
  activeSessionId: null
};

// ==================================================
// DOM REFERENCES
// ==================================================
const dom = {
  activeSessionBadge: document.getElementById("activeSessionBadge"),
  scrambleDisplay: document.getElementById("scrambleDisplay"),
  timerTouchArea: document.getElementById("timerTouchArea"),
  timerDisplay: document.getElementById("timerDisplay"),
  solveActionButtons: document.getElementById("solveActionButtons"),
  deleteSolveButton: document.getElementById("deleteSolveButton"),
  plusTwoPenaltyButton: document.getElementById("plusTwoPenaltyButton"),
  dnfPenaltyButton: document.getElementById("dnfPenaltyButton"),
  bestSolveDisplay: document.getElementById("bestSolveDisplay"),
  meanSolveDisplay: document.getElementById("meanSolveDisplay"),
  solveCountDisplay: document.getElementById("solveCountDisplay"),
  averageOf5Display: document.getElementById("averageOf5Display"),
  averageOf12Display: document.getElementById("averageOf12Display"),
  averageOf50Display: document.getElementById("averageOf50Display"),
  // Session Modal
  sessionModal: document.getElementById("sessionModal"),
  openSessionModalButton: document.getElementById("openSessionModalButton"),
  closeSessionModalButton: document.getElementById("closeSessionModalButton"),
  newSessionNameInput: document.getElementById("newSessionNameInput"),
  createSessionButton: document.getElementById("createSessionButton"),
  sessionList: document.getElementById("sessionList"),
  // History Modal
  historyModal: document.getElementById("historyModal"),
  openHistoryModalButton: document.getElementById("openHistoryModalButton"),
  closeHistoryModalButton: document.getElementById("closeHistoryModalButton"),
  modalTotalSolves: document.getElementById("modalTotalSolves"),
  modalSessionBest: document.getElementById("modalSessionBest"),
  modalSessionMean: document.getElementById("modalSessionMean"),
  solveHistoryList: document.getElementById("solveHistoryList"),
  clearSessionButton: document.getElementById("clearSessionButton")
};

// ==================================================
// SESSION HELPERS
// ==================================================
function getActiveSession() {
  return state.sessions.find(s => s.id === state.activeSessionId) || state.sessions[0];
}

function getActiveSolves() {
  const currentSession = getActiveSession();
  return currentSession ? currentSession.solves : [];
}

function createNewSession(sessionName) {
  const trimmedName = (sessionName || "").trim();
  const finalName = trimmedName.length > 0 ? trimmedName : `Session ${state.sessions.length + 1}`;
  
  const newSession = {
    id: "session_" + Date.now(),
    name: finalName,
    solves: []
  };

  state.sessions.push(newSession);
  state.activeSessionId = newSession.id;
  saveSessionsToLocalStorage();
  updateSessionUI();
  updateAllStatisticsUI();
}

function switchSession(sessionId) {
  state.activeSessionId = sessionId;
  saveSessionsToLocalStorage();
  updateSessionUI();
  updateAllStatisticsUI();
  hideSolveActionButtons();
  dom.timerDisplay.textContent = "0.00";
  state.currentTimerState = TIMER_STATES.IDLE;
  closeAllModals();
}

function deleteSession(sessionId, event) {
  if (event) event.stopPropagation();
  if (state.sessions.length <= 1) {
    alert("You must keep at least one session.");
    return;
  }

  const sessionToDelete = state.sessions.find(s => s.id === sessionId);
  const confirmed = window.confirm(`Delete "${sessionToDelete.name}" and all its solves?`);
  if (!confirmed) return;

  state.sessions = state.sessions.filter(s => s.id !== sessionId);

  if (state.activeSessionId === sessionId) {
    state.activeSessionId = state.sessions[0].id;
  }

  saveSessionsToLocalStorage();
  updateSessionUI();
  updateAllStatisticsUI();
}

function updateSessionUI() {
  const currentSession = getActiveSession();
  if (!currentSession) return;

  dom.activeSessionBadge.textContent = `Session: ${currentSession.name}`;
  renderSessionList();
}

function renderSessionList() {
  dom.sessionList.innerHTML = "";

  state.sessions.forEach(session => {
    const item = document.createElement("li");
    item.className = `session-item ${session.id === state.activeSessionId ? "active-session" : ""}`;
    
    item.innerHTML = `
      <div>
        <span class="session-meta-name">${session.name}</span>
        <span class="session-meta-count">(${session.solves.length} solves)</span>
      </div>
      <button class="session-delete-button" title="Delete session">&times;</button>
    `;

    item.addEventListener("click", () => switchSession(session.id));
    const deleteButton = item.querySelector(".session-delete-button");
    deleteButton.addEventListener("click", (e) => deleteSession(session.id, e));

    dom.sessionList.appendChild(item);
  });
}

// ==================================================
// SCRAMBLE GENERATOR
// ==================================================
function generateScramble() {
  const moveSequence = [];
  let previousFace = null;
  let secondPreviousFace = null;

  while (moveSequence.length < SCRAMBLE_LENGTH) {
    const randomFace = FACES[Math.floor(Math.random() * FACES.length)];
    const randomModifier = MODIFIERS[Math.floor(Math.random() * MODIFIERS.length)];

    if (randomFace === previousFace) continue;

    if (secondPreviousFace && previousFace) {
      const isSameAxisAsPrev = MOVE_AXIS_MAP[randomFace] === MOVE_AXIS_MAP[previousFace];
      const isSameAxisAsSecPrev = MOVE_AXIS_MAP[randomFace] === MOVE_AXIS_MAP[secondPreviousFace];
      if (isSameAxisAsPrev && isSameAxisAsSecPrev) continue;
    }

    moveSequence.push(`${randomFace}${randomModifier}`);
    secondPreviousFace = previousFace;
    previousFace = randomFace;
  }

  return moveSequence.join(" ");
}

function updateScrambleUI() {
  state.currentScrambleText = generateScramble();
  dom.scrambleDisplay.textContent = state.currentScrambleText;
}

// ==================================================
// CORE TIMER LOGIC
// ==================================================
function beginHoldToStart() {
  if (state.currentTimerState === TIMER_STATES.IDLE || state.currentTimerState === TIMER_STATES.STOPPED) {
    state.currentTimerState = TIMER_STATES.HOLDING;
    dom.timerDisplay.textContent = "0.00";
    dom.timerDisplay.className = "timer-display state-holding";
    hideSolveActionButtons();

    state.holdTimeoutId = setTimeout(() => {
      if (state.currentTimerState === TIMER_STATES.HOLDING) {
        state.currentTimerState = TIMER_STATES.READY;
        dom.timerDisplay.className = "timer-display state-ready";
      }
    }, HOLD_DURATION_MS);
  }
}

function releaseHoldToStart() {
  if (state.currentTimerState === TIMER_STATES.HOLDING) {
    clearTimeout(state.holdTimeoutId);
    state.currentTimerState = TIMER_STATES.IDLE;
    dom.timerDisplay.className = "timer-display";
  } else if (state.currentTimerState === TIMER_STATES.READY) {
    startTimer();
  }
}

function startTimer() {
  state.currentTimerState = TIMER_STATES.RUNNING;
  dom.timerDisplay.className = "timer-display";
  state.timerStartPerformanceTimestamp = performance.now();
  
  hideSolveActionButtons();
  renderTimerLoop();
}

function stopTimer() {
  if (state.currentTimerState !== TIMER_STATES.RUNNING) return;

  const stopPerformanceTimestamp = performance.now();
  cancelAnimationFrame(state.animationFrameRequestId);
  
  state.currentSolveElapsedTimeMs = stopPerformanceTimestamp - state.timerStartPerformanceTimestamp;
  state.currentTimerState = TIMER_STATES.STOPPED;

  const rawSeconds = state.currentSolveElapsedTimeMs / 1000;
  dom.timerDisplay.textContent = formatTime(rawSeconds);

  recordCompletedSolve(rawSeconds);
  showSolveActionButtons();
}

function renderTimerLoop() {
  if (state.currentTimerState !== TIMER_STATES.RUNNING) return;

  const currentElapsedTime = (performance.now() - state.timerStartPerformanceTimestamp) / 1000;
  dom.timerDisplay.textContent = formatTime(currentElapsedTime);
  state.animationFrameRequestId = requestAnimationFrame(renderTimerLoop);
}

function formatTime(seconds) {
  if (seconds === Infinity || isNaN(seconds)) return "DNF";
  return seconds.toFixed(2);
}

// ==================================================
// SOLVE & STATS MANAGEMENT (SCOPED TO SESSION)
// ==================================================
function recordCompletedSolve(rawSeconds) {
  const currentSession = getActiveSession();
  if (!currentSession) return;

  const newSolve = {
    solveNumber: currentSession.solves.length + 1,
    rawTime: rawSeconds,
    penalty: "none",
    effectiveTime: rawSeconds,
    scramble: state.currentScrambleText,
    timestamp: Date.now()
  };

  currentSession.solves.push(newSolve);
  saveSessionsToLocalStorage();
  updateAllStatisticsUI();
  updateSessionUI();
  updateScrambleUI();
}

function applyPenaltyToLatestSolve(penaltyType) {
  const currentSolves = getActiveSolves();
  if (currentSolves.length === 0) return;

  const latestSolve = currentSolves[currentSolves.length - 1];

  if (latestSolve.penalty === penaltyType) {
    latestSolve.penalty = "none";
    latestSolve.effectiveTime = latestSolve.rawTime;
  } else {
    latestSolve.penalty = penaltyType;
    if (penaltyType === "plus2") {
      latestSolve.effectiveTime = latestSolve.rawTime + 2.0;
    } else if (penaltyType === "dnf") {
      latestSolve.effectiveTime = Infinity;
    }
  }

  saveSessionsToLocalStorage();
  updateAllStatisticsUI();
  updatePenaltyButtonStyles(latestSolve.penalty);

  if (latestSolve.penalty === "dnf") {
    dom.timerDisplay.textContent = "DNF";
  } else {
    dom.timerDisplay.textContent = formatTime(latestSolve.effectiveTime);
  }
}

function deleteLatestSolve() {
  const currentSession = getActiveSession();
  if (!currentSession || currentSession.solves.length === 0) return;

  currentSession.solves.pop();
  saveSessionsToLocalStorage();
  updateAllStatisticsUI();
  updateSessionUI();
  hideSolveActionButtons();
  dom.timerDisplay.textContent = "0.00";
  state.currentTimerState = TIMER_STATES.IDLE;
}

// ==================================================
// MATHEMATICAL STATS ENGINE
// ==================================================
function calculateSessionStatistics() {
  const solves = getActiveSolves();
  const count = solves.length;
  if (count === 0) {
    return { best: null, mean: null, count: 0, ao5: null, ao12: null, ao50: null };
  }

  let best = Infinity;
  let validSolveSum = 0;
  let validSolveCount = 0;

  for (const solve of solves) {
    if (solve.penalty !== "dnf") {
      if (solve.effectiveTime < best) {
        best = solve.effectiveTime;
      }
      validSolveSum += solve.effectiveTime;
      validSolveCount++;
    }
  }

  const mean = validSolveCount > 0 ? validSolveSum / validSolveCount : null;
  const calculatedBest = best === Infinity ? null : best;

  return {
    best: calculatedBest,
    mean: mean,
    count: count,
    ao5: calculateAverageOfTrimmedWindow(solves, 5),
    ao12: calculateAverageOfTrimmedWindow(solves, 12),
    ao50: calculateAverageOfTrimmedWindow(solves, 50)
  };
}

function calculateAverageOfTrimmedWindow(solves, windowSize) {
  if (solves.length < windowSize) return null;

  const subset = solves.slice(solves.length - windowSize);
  const effectiveTimes = subset.map(s => s.effectiveTime);

  effectiveTimes.sort((a, b) => a - b);

  const dnfCount = effectiveTimes.filter(t => t === Infinity).length;
  if (dnfCount >= 2) {
    return Infinity;
  }

  const trimmedTimes = effectiveTimes.slice(1, effectiveTimes.length - 1);
  const sum = trimmedTimes.reduce((acc, current) => acc + current, 0);

  return sum / trimmedTimes.length;
}

function updateAllStatisticsUI() {
  const stats = calculateSessionStatistics();

  dom.solveCountDisplay.textContent = stats.count;
  dom.bestSolveDisplay.textContent = stats.best !== null ? formatTime(stats.best) : "--";
  dom.meanSolveDisplay.textContent = stats.mean !== null ? formatTime(stats.mean) : "--";
  dom.averageOf5Display.textContent = stats.ao5 !== null ? formatTime(stats.ao5) : "--";
  dom.averageOf12Display.textContent = stats.ao12 !== null ? formatTime(stats.ao12) : "--";
  dom.averageOf50Display.textContent = stats.ao50 !== null ? formatTime(stats.ao50) : "--";

  if (!dom.historyModal.classList.contains("hidden")) {
    renderHistoryModalContent();
  }
}

// ==================================================
// SOLVE ACTIONS UI
// ==================================================
function showSolveActionButtons() {
  dom.solveActionButtons.classList.remove("hidden");
  const currentSolves = getActiveSolves();
  const latestSolve = currentSolves[currentSolves.length - 1];
  updatePenaltyButtonStyles(latestSolve ? latestSolve.penalty : "none");
}

function hideSolveActionButtons() {
  dom.solveActionButtons.classList.add("hidden");
  updatePenaltyButtonStyles("none");
}

function updatePenaltyButtonStyles(penalty) {
  dom.plusTwoPenaltyButton.classList.toggle("action-active", penalty === "plus2");
  dom.dnfPenaltyButton.classList.toggle("action-active", penalty === "dnf");
}

// ==================================================
// MODAL MANAGEMENT
// ==================================================
function closeAllModals() {
  dom.sessionModal.classList.add("hidden");
  dom.historyModal.classList.add("hidden");
}

function openSessionModal() {
  renderSessionList();
  dom.sessionModal.classList.remove("hidden");
}

function renderHistoryModalContent() {
  const stats = calculateSessionStatistics();
  const currentSolves = getActiveSolves();

  dom.modalTotalSolves.textContent = stats.count;
  dom.modalSessionBest.textContent = stats.best !== null ? formatTime(stats.best) : "--";
  dom.modalSessionMean.textContent = stats.mean !== null ? formatTime(stats.mean) : "--";

  dom.solveHistoryList.innerHTML = "";

  for (let index = currentSolves.length - 1; index >= 0; index--) {
    const solve = currentSolves[index];
    const listItem = document.createElement("li");
    listItem.className = "history-entry-item";

    let displayFormattedTime = formatTime(solve.effectiveTime);
    if (solve.penalty === "plus2") {
      displayFormattedTime = `${formatTime(solve.effectiveTime)} (+2)`;
    } else if (solve.penalty === "dnf") {
      displayFormattedTime = `DNF (${formatTime(solve.rawTime)})`;
    }

    listItem.innerHTML = `
      <div class="history-entry-primary">
        <span>#${solve.solveNumber}</span>
        <span>${displayFormattedTime}</span>
      </div>
      <div class="history-entry-scramble">${solve.scramble}</div>
    `;

    dom.solveHistoryList.appendChild(listItem);
  }
}

function openHistoryModal() {
  renderHistoryModalContent();
  dom.historyModal.classList.remove("hidden");
}

function clearCurrentSession() {
  const currentSession = getActiveSession();
  if (!currentSession) return;

  const confirmed = window.confirm(`Clear all solves in "${currentSession.name}"?`);
  if (confirmed) {
    currentSession.solves = [];
    saveSessionsToLocalStorage();
    updateAllStatisticsUI();
    updateSessionUI();
    hideSolveActionButtons();
    dom.timerDisplay.textContent = "0.00";
    state.currentTimerState = TIMER_STATES.IDLE;
    updateScrambleUI();
    renderHistoryModalContent();
  }
}

// ==================================================
// LOCAL STORAGE PERSISTENCE
// ==================================================
function saveSessionsToLocalStorage() {
  try {
    localStorage.setItem(LOCAL_STORAGE_SESSIONS_KEY, JSON.stringify(state.sessions));
    localStorage.setItem(LOCAL_STORAGE_ACTIVE_SESSION_KEY, state.activeSessionId);
  } catch (error) {
    console.error("Failed to persist sessions to LocalStorage:", error);
  }
}

function loadSessionsFromLocalStorage() {
  try {
    const data = localStorage.getItem(LOCAL_STORAGE_SESSIONS_KEY);
    const activeId = localStorage.getItem(LOCAL_STORAGE_ACTIVE_SESSION_KEY);

    if (data) {
      const parsedSessions = JSON.parse(data);
      if (Array.isArray(parsedSessions) && parsedSessions.length > 0) {
        state.sessions = parsedSessions;
        state.activeSessionId = activeId || parsedSessions[0].id;
        return;
      }
    }
  } catch (error) {
    console.warn("Corrupted session data, initializing new default session:", error);
  }

  // Fallback initial default session
  const defaultSession = {
    id: "session_default",
    name: "Default",
    solves: []
  };
  state.sessions = [defaultSession];
  state.activeSessionId = defaultSession.id;
  saveSessionsToLocalStorage();
}

// ==================================================
// INPUT HANDLERS
// ==================================================
function isAnyModalOpen() {
  return !dom.sessionModal.classList.contains("hidden") || !dom.historyModal.classList.contains("hidden");
}

function handleKeyboardDown(event) {
  if (event.code !== "Space" || event.repeat) return;
  if (isAnyModalOpen()) return;

  event.preventDefault();

  if (state.activeInputSource === INPUT_SOURCES.TOUCH) return;
  state.activeInputSource = INPUT_SOURCES.KEYBOARD;

  if (state.currentTimerState === TIMER_STATES.RUNNING) {
    stopTimer();
  } else if (state.currentTimerState === TIMER_STATES.IDLE || state.currentTimerState === TIMER_STATES.STOPPED) {
    beginHoldToStart();
  }
}

function handleKeyboardUp(event) {
  if (event.code !== "Space") return;
  if (state.activeInputSource !== INPUT_SOURCES.KEYBOARD) return;

  event.preventDefault();
  releaseHoldToStart();
  state.activeInputSource = INPUT_SOURCES.NONE;
}

function handleTouchStart(event) {
  if (isAnyModalOpen()) return;
  if (event.target.closest("#solveActionButtons")) return;

  if (state.activeInputSource === INPUT_SOURCES.KEYBOARD) return;
  state.activeInputSource = INPUT_SOURCES.TOUCH;

  if (state.currentTimerState === TIMER_STATES.RUNNING) {
    stopTimer();
  } else if (state.currentTimerState === TIMER_STATES.IDLE || state.currentTimerState === TIMER_STATES.STOPPED) {
    beginHoldToStart();
  }
}

function handleTouchEnd(event) {
  if (event.target.closest("#solveActionButtons")) return;
  if (state.activeInputSource !== INPUT_SOURCES.TOUCH) return;

  releaseHoldToStart();
  state.activeInputSource = INPUT_SOURCES.NONE;
}

// ==================================================
// INITIALIZATION
// ==================================================
function initializeApplication() {
  loadSessionsFromLocalStorage();
  updateSessionUI();
  updateScrambleUI();
  updateAllStatisticsUI();

  // Keyboard
  window.addEventListener("keydown", handleKeyboardDown, { passive: false });
  window.addEventListener("keyup", handleKeyboardUp, { passive: false });

  // Touch / Mouse
  dom.timerTouchArea.addEventListener("touchstart", handleTouchStart, { passive: true });
  dom.timerTouchArea.addEventListener("touchend", handleTouchEnd, { passive: true });
  dom.timerTouchArea.addEventListener("mousedown", handleTouchStart);
  dom.timerTouchArea.addEventListener("mouseup", handleTouchEnd);

  // Solve Action Buttons
  dom.deleteSolveButton.addEventListener("click", deleteLatestSolve);
  dom.plusTwoPenaltyButton.addEventListener("click", () => applyPenaltyToLatestSolve("plus2"));
  dom.dnfPenaltyButton.addEventListener("click", () => applyPenaltyToLatestSolve("dnf"));

  // Session Manager Controls
  dom.openSessionModalButton.addEventListener("click", openSessionModal);
  dom.closeSessionModalButton.addEventListener("click", () => dom.sessionModal.classList.add("hidden"));
  dom.createSessionButton.addEventListener("click", () => {
    createNewSession(dom.newSessionNameInput.value);
    dom.newSessionNameInput.value = "";
  });
  dom.newSessionNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      createNewSession(dom.newSessionNameInput.value);
      dom.newSessionNameInput.value = "";
    }
  });

  // History Controls
  dom.openHistoryModalButton.addEventListener("click", openHistoryModal);
  dom.closeHistoryModalButton.addEventListener("click", () => dom.historyModal.classList.add("hidden"));
  dom.clearSessionButton.addEventListener("click", clearCurrentSession);

  // Overlay click dismiss
  dom.sessionModal.addEventListener("click", (e) => {
    if (e.target === dom.sessionModal) dom.sessionModal.classList.add("hidden");
  });
  dom.historyModal.addEventListener("click", (e) => {
    if (e.target === dom.historyModal) dom.historyModal.classList.add("hidden");
  });
}

document.addEventListener("DOMContentLoaded", initializeApplication);
