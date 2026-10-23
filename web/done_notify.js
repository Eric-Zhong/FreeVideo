// Tells the user a long run has finished while FreeVideo is in a background tab:
// the tab title flashes and one short beep plays until the page is shown again.
// Desktop notifications default on; an explicit opt-out keeps them off.
// Only a queue that ran a FreeVideo node counts: other workflows finish silently.
export const DESKTOP_SETTING = 'FreeVideo.DoneNotify.Desktop';
const PERMISSION_ASKED = 'freevideo.desktop.notification-asked';
const permissionAsked = new WeakSet();
const LONG_RUN_MS = 20000, FLASH_MS = 1000;

export function startDoneNotify({api, text, doc = document, win = window, now = () => Date.now(), desktop = () => true, isFreeVideoNode = () => false,
    isFreeVideoWorkflow = () => false,
    beep = playBeep, notify = desktopNotice, minimum = LONG_RUN_MS, setTimer = setInterval, clearTimer = clearInterval} = {}) {
    let busySince = null, failed = false, cancelled = false, flashing = null, involved = false;
    const away = () => doc.hidden || (typeof doc.hasFocus === 'function' && !doc.hasFocus());

    function stopFlashing() {
        if (!flashing) return;
        clearTimer(flashing.timer); doc.title = flashing.title; flashing = null;
    }
    function remind(ok) {
        const label = ok ? text('✓ Done', '✓ 已完成') : text('✕ Stopped', '✕ 已停止');
        stopFlashing();
        const title = doc.title; let lit = false;
        const tick = () => { lit = !lit; doc.title = lit ? label : title; };
        flashing = {title, timer: setTimer(tick, FLASH_MS)}; tick();
        try { beep(win); } catch { /* A browser may block sound before the first click. */ }
        try { if (desktop()) notify(win, label, () => { win.focus?.(); stopFlashing(); }); } catch { /* Notifications are optional. */ }
    }
    function status(event) {
        const remaining = event?.detail?.exec_info?.queue_remaining;
        if (!Number.isFinite(remaining)) return;
        if (remaining > 0) {
            if (busySince === null) { busySince = now(); failed = false; cancelled = false; involved = false; }
            return;
        }
        if (busySince === null) return;
        const elapsed = now() - busySince; busySince = null;
        if (!involved || cancelled || elapsed < minimum || !away()) return;
        remind(!failed);
    }
    const error = event => { failed = true; if (/^FreeVideo/.test(String(event?.detail?.node_type || ''))) involved = true; };
    const freevideo = () => { involved = true; };
    const executing = event => {
        const id = typeof event?.detail === 'object' ? event.detail?.node : event?.detail;
        if (id != null && isFreeVideoNode(id)) involved = true;
    };
    const interrupted = () => { cancelled = true; };
    const shown = () => { if (!away()) stopFlashing(); };
    // Capture the actual Generate click before the host starts any async work.
    // The workspace marks its button; current and older ComfyUI use the other two.
    const generate = event => {
        const button = event.target?.closest?.('[data-fv-guide="generate"], [data-testid="queue-button"], #queue-button');
        if (button && !button.disabled && desktop() && isFreeVideoWorkflow()) askDesktopPermission(win);
    };
    api.addEventListener('status', status);
    api.addEventListener('execution_error', error);
    api.addEventListener('execution_interrupted', interrupted);
    api.addEventListener('freevideo_progress', freevideo);
    api.addEventListener('freevideo_prewarm', freevideo);
    api.addEventListener('executing', executing);
    doc.addEventListener('visibilitychange', shown);
    doc.addEventListener('click', generate, true);
    win.addEventListener?.('focus', shown);
    return {stop() {
        api.removeEventListener('status', status); api.removeEventListener('execution_error', error);
        api.removeEventListener('execution_interrupted', interrupted);
        api.removeEventListener('freevideo_progress', freevideo); api.removeEventListener('freevideo_prewarm', freevideo);
        api.removeEventListener('executing', executing);
        doc.removeEventListener('visibilitychange', shown); doc.removeEventListener('click', generate, true);
        win.removeEventListener?.('focus', shown); stopFlashing();
    }};
}

function playBeep(win) {
    const Context = win.AudioContext || win.webkitAudioContext;
    if (!Context) return;
    const context = new Context();
    if (context.state === 'suspended') context.resume?.();
    const tone = context.createOscillator(), gain = context.createGain(), start = context.currentTime;
    tone.type = 'sine'; tone.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
    tone.connect(gain); gain.connect(context.destination);
    tone.start(start); tone.stop(start + 0.4);
    tone.onended = () => context.close?.();
}

function desktopNotice(win, label, clicked) {
    const Notice = win.Notification;
    if (!Notice || Notice.permission !== 'granted') return;
    const notice = new Notice(`${label} · FreeVideo`);
    notice.onclick = () => { clicked(); notice.close?.(); };
}

// Call synchronously from a Generate gesture, never at startup or on completion.
// A user turning the setting on is an explicit request, so it ignores the earlier record.
export function askDesktopPermission(win = window, {explicit = false} = {}) {
    const Notice = win.Notification;
    if (Notice?.permission !== 'default' || typeof Notice.requestPermission !== 'function') return;
    if (!explicit) {
        if (permissionAsked.has(win)) return;
        try { if (win.localStorage.getItem(PERMISSION_ASKED) === '1') return; } catch { /* Storage may be blocked. */ }
    }
    // Remember before requesting, including dismissals, throws and pending promises.
    permissionAsked.add(win);
    try { win.localStorage.setItem(PERMISSION_ASKED, '1'); } catch { /* Keep the in-memory guard. */ }
    try { Notice.requestPermission()?.catch?.(() => {}); } catch { /* Optional. */ }
}
