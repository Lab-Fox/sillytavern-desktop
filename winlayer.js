// Window layer: normal, always on top, or always in the background.
// "On top" is built into Electron, but Electron ignores it (and moveTop)
// while a window is full screen, so on Windows we also set the z-order
// with SetWindowPos ourselves. "Background" isn't built in at all: we hook
// WM_WINDOWPOSCHANGING and rewrite every z-order change to HWND_BOTTOM, so
// the window stays under other apps even while it has focus.
import koffi from 'koffi';

export const MODES = ['normal', 'top', 'bottom'];
const WM_WINDOWPOSCHANGING = 0x0046;
const HWND_TOP = 0, HWND_BOTTOM = 1, HWND_TOPMOST = -1, HWND_NOTOPMOST = -2;
const SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10;

let SetWindowPos = null;
function setZOrder(win, after) {
    if (!SetWindowPos) {
        SetWindowPos = koffi.load('user32.dll')
            .func('bool __stdcall SetWindowPos(intptr hWnd, intptr after, int x, int y, int cx, int cy, uint flags)');
    }
    const hwnd = Number(win.getNativeWindowHandle().readBigInt64LE(0));
    SetWindowPos(hwnd, after, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}

// Safe to call again with the same mode (e.g. after leaving full screen,
// which restores the window's old style).
export function apply(win, mode) {
    // Unhook first: while hooked, every reorder below would become "bottom".
    const wasBottom = process.platform === 'win32' && win.isWindowMessageHooked(WM_WINDOWPOSCHANGING);
    if (wasBottom) win.unhookWindowMessage(WM_WINDOWPOSCHANGING);
    win.setAlwaysOnTop(mode === 'top', 'floating');
    if (process.platform !== 'win32') return;
    if (mode === 'top') {
        setZOrder(win, HWND_TOPMOST);
    } else if (mode === 'bottom') {
        setZOrder(win, HWND_NOTOPMOST);
        win.hookWindowMessage(WM_WINDOWPOSCHANGING, (_wParam, lParam) => {
            // lParam points at a WINDOWPOS: hwnd, hwndInsertAfter, x, y, cx, cy, flags
            const pos = koffi.decode(lParam, 'void *');
            if (!(koffi.decode(pos, 32, 'uint') & SWP_NOZORDER)) koffi.encode(pos, 8, 'intptr', HWND_BOTTOM);
        });
        setZOrder(win, HWND_BOTTOM);
    } else {
        setZOrder(win, HWND_NOTOPMOST);
        if (wasBottom) setZOrder(win, HWND_TOP); // back in front, where the user expects it
    }
}
