/**
 * screen-capture.cpp — Windows / Linux 原生截图 & 取色模块
 *
 * API:
 *   captureScreen(displayIndex?: number) → { buffer: Buffer, width, height }
 *   captureRegion(x, y, w, h) → { buffer: Buffer, width, height }
 *   getPixelColor(x, y) → { r, g, b }
 *   getDisplays() → Array<{ id, x, y, width, height, scaleFactor }>
 *
 * 返回 raw BGRA bitmap，由 JS 层 nativeImage.createFromBitmap() 转 PNG。
 */

#include <napi.h>

// ============================================================
// Windows 实现
// ============================================================
#ifdef _WIN32
#include <windows.h>
#include <windowsx.h>
#include <thread>
#include <atomic>
#include <vector>
#include <cwchar>

/**
 * 截取指定区域的屏幕内容
 * 返回 BGRA 格式的 raw bitmap 数据
 */
static Napi::Object CaptureRectWin(Napi::Env env, int x, int y, int width, int height) {
    HDC hScreenDC = GetDC(NULL);
    HDC hMemDC = CreateCompatibleDC(hScreenDC);

    BITMAPINFOHEADER bi = {};
    bi.biSize = sizeof(BITMAPINFOHEADER);
    bi.biWidth = width;
    bi.biHeight = -height;  // 负值 = 自上而下（top-down DIB）
    bi.biPlanes = 1;
    bi.biBitCount = 32;     // BGRA
    bi.biCompression = BI_RGB;

    void* pBits = nullptr;
    HBITMAP hBitmap = CreateDIBSection(hMemDC, (BITMAPINFO*)&bi, DIB_RGB_COLORS, &pBits, NULL, 0);

    if (!hBitmap || !pBits) {
        DeleteDC(hMemDC);
        ReleaseDC(NULL, hScreenDC);
        Napi::Error::New(env, "截图失败: CreateDIBSection 返回空").ThrowAsJavaScriptException();
        return Napi::Object::New(env);
    }

    HBITMAP hOldBitmap = (HBITMAP)SelectObject(hMemDC, hBitmap);

    // BitBlt 复制屏幕内容到内存 DC
    BitBlt(hMemDC, 0, 0, width, height, hScreenDC, x, y, SRCCOPY);

    SelectObject(hMemDC, hOldBitmap);

    // 复制 bitmap 数据到 Node Buffer
    size_t totalBytes = (size_t)width * height * 4;
    auto buffer = Napi::Buffer<uint8_t>::Copy(env, static_cast<uint8_t*>(pBits), totalBytes);

    // 清理 GDI 资源
    DeleteObject(hBitmap);
    DeleteDC(hMemDC);
    ReleaseDC(NULL, hScreenDC);

    Napi::Object result = Napi::Object::New(env);
    result.Set("buffer", buffer);
    result.Set("width", Napi::Number::New(env, width));
    result.Set("height", Napi::Number::New(env, height));

    return result;
}

/**
 * captureScreen(displayIndex?: number) → { buffer, width, height }
 */
static Napi::Value CaptureScreen(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    uint32_t displayIndex = 0;
    if (info.Length() > 0 && info[0].IsNumber()) {
        displayIndex = info[0].As<Napi::Number>().Uint32Value();
    }

    // 枚举显示器
    struct MonitorInfo {
        RECT rect;
        UINT dpi;
    };
    std::vector<MonitorInfo> monitors;

    EnumDisplayMonitors(NULL, NULL, [](HMONITOR hMon, HDC, LPRECT, LPARAM data) -> BOOL {
        auto* list = reinterpret_cast<std::vector<MonitorInfo>*>(data);
        MONITORINFO mi = {};
        mi.cbSize = sizeof(mi);
        GetMonitorInfo(hMon, &mi);

        // 获取 DPI（Windows 8.1+）
        UINT dpiX = 96, dpiY = 96;
        typedef HRESULT(WINAPI* GetDpiFunc)(HMONITOR, int, UINT*, UINT*);
        HMODULE shcore = GetModuleHandleA("shcore.dll");
        if (shcore) {
            auto fn = (GetDpiFunc)GetProcAddress(shcore, "GetDpiForMonitor");
            if (fn) fn(hMon, 0 /* MDT_EFFECTIVE_DPI */, &dpiX, &dpiY);
        }

        list->push_back({ mi.rcMonitor, dpiX });
        return TRUE;
    }, reinterpret_cast<LPARAM>(&monitors));

    if (monitors.empty()) {
        Napi::Error::New(env, "截图失败: 没有可用的显示器").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (displayIndex >= monitors.size()) displayIndex = 0;

    const auto& mon = monitors[displayIndex];
    int x = mon.rect.left;
    int y = mon.rect.top;
    int w = mon.rect.right - mon.rect.left;
    int h = mon.rect.bottom - mon.rect.top;

    return CaptureRectWin(env, x, y, w, h);
}

/**
 * captureRegion(x, y, width, height) → { buffer, width, height }
 */
static Napi::Value CaptureRegion(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 4) {
        Napi::TypeError::New(env, "需要 4 个参数: x, y, width, height").ThrowAsJavaScriptException();
        return env.Null();
    }

    int x = info[0].As<Napi::Number>().Int32Value();
    int y = info[1].As<Napi::Number>().Int32Value();
    int w = info[2].As<Napi::Number>().Int32Value();
    int h = info[3].As<Napi::Number>().Int32Value();

    if (w <= 0 || h <= 0) {
        Napi::TypeError::New(env, "width 和 height 必须大于 0").ThrowAsJavaScriptException();
        return env.Null();
    }

    return CaptureRectWin(env, x, y, w, h);
}

/**
 * getPixelColor(x, y) → { r, g, b }
 */
static Napi::Value GetPixelColor(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "需要 2 个参数: x, y").ThrowAsJavaScriptException();
        return env.Null();
    }

    int x = info[0].As<Napi::Number>().Int32Value();
    int y = info[1].As<Napi::Number>().Int32Value();

    HDC hDC = GetDC(NULL);
    COLORREF color = GetPixel(hDC, x, y);
    ReleaseDC(NULL, hDC);

    Napi::Object result = Napi::Object::New(env);
    result.Set("r", Napi::Number::New(env, GetRValue(color)));
    result.Set("g", Napi::Number::New(env, GetGValue(color)));
    result.Set("b", Napi::Number::New(env, GetBValue(color)));

    return result;
}

/**
 * getDisplays() → Array<{ id, x, y, width, height, scaleFactor }>
 */
static Napi::Value GetDisplays(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    struct DisplayEntry {
        int id;
        RECT rect;
        double scaleFactor;
    };
    std::vector<DisplayEntry> displays;
    int counter = 0;

    auto enumCtx = std::make_pair(&displays, &counter);

    EnumDisplayMonitors(NULL, NULL, [](HMONITOR hMon, HDC, LPRECT, LPARAM data) -> BOOL {
        auto* ctx = reinterpret_cast<std::pair<std::vector<DisplayEntry>*, int*>*>(data);
        MONITORINFO mi = {};
        mi.cbSize = sizeof(mi);
        GetMonitorInfo(hMon, &mi);

        UINT dpiX = 96, dpiY = 96;
        typedef HRESULT(WINAPI* GetDpiFunc)(HMONITOR, int, UINT*, UINT*);
        HMODULE shcore = GetModuleHandleA("shcore.dll");
        if (shcore) {
            auto fn = (GetDpiFunc)GetProcAddress(shcore, "GetDpiForMonitor");
            if (fn) fn(hMon, 0, &dpiX, &dpiY);
        }

        ctx->first->push_back({
            (*ctx->second)++,
            mi.rcMonitor,
            dpiX / 96.0
        });
        return TRUE;
    }, reinterpret_cast<LPARAM>(&enumCtx));

    Napi::Array result = Napi::Array::New(env, displays.size());
    for (size_t i = 0; i < displays.size(); i++) {
        const auto& d = displays[i];
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("id", Napi::Number::New(env, d.id));
        obj.Set("x", Napi::Number::New(env, d.rect.left));
        obj.Set("y", Napi::Number::New(env, d.rect.top));
        obj.Set("width", Napi::Number::New(env, d.rect.right - d.rect.left));
        obj.Set("height", Napi::Number::New(env, d.rect.bottom - d.rect.top));
        obj.Set("scaleFactor", Napi::Number::New(env, d.scaleFactor));
        result.Set(static_cast<uint32_t>(i), obj);
    }

    return result;
}

// ============================================================
// Windows: Native Region Capture (fullscreen overlay)
// ============================================================
#include <dwmapi.h>
#pragma comment(lib, "dwmapi.lib")

struct RegionCaptureResult {
    bool success;
    int x, y, width, height;
    std::vector<uint8_t> pixels;
    int imageWidth, imageHeight;
};

// Window rectangle for snapping
struct WinRect { RECT r; };

static const wchar_t* RC_CLASS = L"MulbyRegionCapture";
static bool g_rcClassRegistered = false;
static std::atomic<bool> g_rcActive{false};

struct RCState {
    int vsX, vsY, vsW, vsH;
    // Screen bitmaps
    HDC hOrigDC, hDimDC;
    HBITMAP hOrigBmp, hDimBmp;
    HBITMAP hOldOrig, hOldDim;
    void* pOrigBits;
    void* pDimBits;
    // Double buffer
    HDC hBackDC;
    HBITMAP hBackBmp, hOldBack;
    // Selection state
    bool selecting;
    int sx, sy, cx, cy;
    // Result
    bool success;
    int selL, selT, selW, selH;
    // Font
    HFONT hFont;
    // Window snapping
    std::vector<WinRect> winRects;
    int hoverIdx; // -1 = no window hovered
};

static inline void RCNormRect(int x1, int y1, int x2, int y2, int& l, int& t, int& w, int& h) {
    l = (x1 < x2) ? x1 : x2;
    t = (y1 < y2) ? y1 : y2;
    w = abs(x2 - x1);
    h = abs(y2 - y1);
}

// Enumerate visible windows for snapping
static BOOL CALLBACK RCEnumWinProc(HWND hwnd, LPARAM lParam) {
    if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return TRUE;

    // Skip desktop and shell windows
    if (hwnd == GetDesktopWindow() || hwnd == GetShellWindow()) return TRUE;

    // Skip DWM-cloaked windows (UWP suspended apps, virtual desktops)
    DWORD cloaked = 0;
    DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &cloaked, sizeof(cloaked));
    if (cloaked) return TRUE;

    // Skip windows without a title (many system-internal windows)
    int titleLen = GetWindowTextLengthW(hwnd);
    if (titleLen == 0) return TRUE;

    // Skip tool windows (tooltips, floating palettes)
    LONG_PTR exStyle = GetWindowLongPtr(hwnd, GWL_EXSTYLE);
    if (exStyle & WS_EX_TOOLWINDOW) return TRUE;

    RECT r;
    if (SUCCEEDED(DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &r, sizeof(r)))) {
        // DWM gives us the visual frame bounds (excludes invisible resize borders)
    } else {
        GetWindowRect(hwnd, &r);
    }
    int w = r.right - r.left, h = r.bottom - r.top;
    if (w < 20 || h < 20) return TRUE;
    auto* v = (std::vector<WinRect>*)lParam;
    v->push_back({r});
    return TRUE;
}

// Find topmost window under screen point
static int RCFindWindow(const RCState& s, int clientX, int clientY) {
    int screenX = clientX + s.vsX;
    int screenY = clientY + s.vsY;
    // EnumWindows returns Z-order; our overlay was not yet created during enum
    for (size_t i = 0; i < s.winRects.size(); i++) {
        const RECT& r = s.winRects[i].r;
        if (screenX >= r.left && screenX < r.right && screenY >= r.top && screenY < r.bottom)
            return (int)i;
    }
    return -1;
}

static void RCPaintTo(HDC hdc, RCState* s) {
    // 1. Dimmed background
    BitBlt(hdc, 0, 0, s->vsW, s->vsH, s->hDimDC, 0, 0, SRCCOPY);

    if (s->selecting) {
        int l, t, w, h;
        RCNormRect(s->sx, s->sy, s->cx, s->cy, l, t, w, h);
        if (w > 0 && h > 0) {
            // Bright selection area
            BitBlt(hdc, l, t, w, h, s->hOrigDC, l, t, SRCCOPY);
            // Blue border
            HPEN pen = CreatePen(PS_SOLID, 2, RGB(0, 122, 255));
            HPEN oldP = (HPEN)SelectObject(hdc, pen);
            HBRUSH oldB = (HBRUSH)SelectObject(hdc, GetStockObject(NULL_BRUSH));
            Rectangle(hdc, l, t, l + w, t + h);
            SelectObject(hdc, oldP); SelectObject(hdc, oldB); DeleteObject(pen);
            // Corner handles
            int cs = 6;
            HBRUSH cb = CreateSolidBrush(RGB(0, 122, 255));
            RECT cn[4] = {
                {l-cs/2, t-cs/2, l+cs/2, t+cs/2}, {l+w-cs/2, t-cs/2, l+w+cs/2, t+cs/2},
                {l-cs/2, t+h-cs/2, l+cs/2, t+h+cs/2}, {l+w-cs/2, t+h-cs/2, l+w+cs/2, t+h+cs/2}
            };
            for (int i = 0; i < 4; i++) FillRect(hdc, &cn[i], cb);
            DeleteObject(cb);
            // Dimension text
            wchar_t txt[64];
            swprintf_s(txt, L"%d \u00D7 %d", w, h);
            HFONT oldF = (HFONT)SelectObject(hdc, s->hFont);
            SIZE sz; GetTextExtentPoint32W(hdc, txt, (int)wcslen(txt), &sz);
            int tx = l, ty = t < 30 ? t + h + 8 : t - sz.cy - 12;
            RECT bg = {tx-6, ty-3, tx+sz.cx+6, ty+sz.cy+3};
            HBRUSH tbg = CreateSolidBrush(RGB(0,0,0));
            FillRect(hdc, &bg, tbg); DeleteObject(tbg);
            SetTextColor(hdc, RGB(255,255,255)); SetBkMode(hdc, TRANSPARENT);
            TextOutW(hdc, tx, ty, txt, (int)wcslen(txt));
            SelectObject(hdc, oldF);
        }
    } else {
        // Window snapping highlight
        if (s->hoverIdx >= 0 && s->hoverIdx < (int)s->winRects.size()) {
            const RECT& wr = s->winRects[s->hoverIdx].r;
            int l = wr.left - s->vsX, t = wr.top - s->vsY;
            int w = wr.right - wr.left, h = wr.bottom - wr.top;
            // Clamp to virtual screen
            if (l < 0) { w += l; l = 0; } if (t < 0) { h += t; t = 0; }
            if (l + w > s->vsW) w = s->vsW - l;
            if (t + h > s->vsH) h = s->vsH - t;
            if (w > 0 && h > 0) {
                BitBlt(hdc, l, t, w, h, s->hOrigDC, l, t, SRCCOPY);
                HPEN pen = CreatePen(PS_SOLID, 2, RGB(0, 122, 255));
                HPEN op = (HPEN)SelectObject(hdc, pen);
                HBRUSH ob = (HBRUSH)SelectObject(hdc, GetStockObject(NULL_BRUSH));
                Rectangle(hdc, l, t, l + w, t + h);
                SelectObject(hdc, op); SelectObject(hdc, ob); DeleteObject(pen);
            }
        }
        // Tip text
        wchar_t tip[] = L"Drag to select region, ESC to cancel";
        HFONT oldF = (HFONT)SelectObject(hdc, s->hFont);
        SIZE sz; GetTextExtentPoint32W(hdc, tip, (int)wcslen(tip), &sz);
        int tx = (s->vsW - sz.cx) / 2, ty = 30;
        RECT bg = {tx-12, ty-6, tx+sz.cx+12, ty+sz.cy+6};
        HBRUSH tbg = CreateSolidBrush(RGB(0,0,0));
        FillRect(hdc, &bg, tbg); DeleteObject(tbg);
        SetTextColor(hdc, RGB(255,255,255)); SetBkMode(hdc, TRANSPARENT);
        TextOutW(hdc, tx, ty, tip, (int)wcslen(tip));
        SelectObject(hdc, oldF);
    }
}

static LRESULT CALLBACK RCWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    RCState* s = (RCState*)GetWindowLongPtr(hwnd, GWLP_USERDATA);

    switch (msg) {
    case WM_CREATE: {
        CREATESTRUCT* cs = (CREATESTRUCT*)lParam;
        SetWindowLongPtr(hwnd, GWLP_USERDATA, (LONG_PTR)cs->lpCreateParams);
        return 0;
    }
    case WM_MOUSEACTIVATE:
        return MA_ACTIVATE; // Process first click (don't eat it)
    case WM_SETCURSOR:
        SetCursor(LoadCursor(NULL, IDC_CROSS));
        return TRUE;
    case WM_ERASEBKGND:
        return 1;

    case WM_PAINT: {
        if (!s) break;
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        // Draw to back buffer, then flip (eliminates flicker)
        RCPaintTo(s->hBackDC, s);
        BitBlt(hdc, 0, 0, s->vsW, s->vsH, s->hBackDC, 0, 0, SRCCOPY);
        EndPaint(hwnd, &ps);
        return 0;
    }

    case WM_LBUTTONDOWN: {
        if (!s) break;
        s->selecting = true;
        s->sx = GET_X_LPARAM(lParam);
        s->sy = GET_Y_LPARAM(lParam);
        s->cx = s->sx; s->cy = s->sy;
        SetCapture(hwnd);
        return 0;
    }
    case WM_MOUSEMOVE: {
        if (!s) break;
        int mx = GET_X_LPARAM(lParam), my = GET_Y_LPARAM(lParam);
        if (s->selecting) {
            s->cx = mx; s->cy = my;
            InvalidateRect(hwnd, NULL, FALSE);
        } else {
            // Window snapping hover
            int idx = RCFindWindow(*s, mx, my);
            if (idx != s->hoverIdx) {
                s->hoverIdx = idx;
                InvalidateRect(hwnd, NULL, FALSE);
            }
        }
        return 0;
    }
    case WM_LBUTTONUP: {
        if (!s || !s->selecting) break;
        s->selecting = false;
        ReleaseCapture();
        s->cx = GET_X_LPARAM(lParam); s->cy = GET_Y_LPARAM(lParam);
        int l, t, w, h;
        RCNormRect(s->sx, s->sy, s->cx, s->cy, l, t, w, h);
        if (w > 5 && h > 5) {
            s->success = true;
            s->selL = l; s->selT = t; s->selW = w; s->selH = h;
            DestroyWindow(hwnd);
        } else if (s->hoverIdx >= 0 && s->hoverIdx < (int)s->winRects.size()) {
            // Window snap: use hovered window rect
            const RECT& wr = s->winRects[s->hoverIdx].r;
            int wl = wr.left - s->vsX, wt = wr.top - s->vsY;
            int ww = wr.right - wr.left, wh = wr.bottom - wr.top;
            // Clamp
            if (wl < 0) { ww += wl; wl = 0; } if (wt < 0) { wh += wt; wt = 0; }
            if (wl + ww > s->vsW) ww = s->vsW - wl;
            if (wt + wh > s->vsH) wh = s->vsH - wt;
            if (ww > 5 && wh > 5) {
                s->success = true;
                s->selL = wl; s->selT = wt; s->selW = ww; s->selH = wh;
                DestroyWindow(hwnd);
            }
        } else {
            InvalidateRect(hwnd, NULL, FALSE);
        }
        return 0;
    }
    case WM_RBUTTONUP: {
        if (!s) break;
        s->success = false;
        if (s->selecting) { s->selecting = false; ReleaseCapture(); }
        DestroyWindow(hwnd);
        return 0;
    }
    case WM_KEYDOWN: {
        if (wParam != VK_ESCAPE) break;
        if (!s) break;
        s->success = false;
        if (s->selecting) { s->selecting = false; ReleaseCapture(); }
        DestroyWindow(hwnd);
        return 0;
    }
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProc(hwnd, msg, wParam, lParam);
}

static Napi::Value StartRegionCapture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function required").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    if (g_rcActive.exchange(true)) {
        Napi::Error::New(env, "Region capture already in progress").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto tsfn = Napi::ThreadSafeFunction::New(
        env, info[0].As<Napi::Function>(),
        "RegionCaptureCB", 0, 1
    );

    std::thread([tsfn]() mutable {
        RCState st = {};
        st.success = false;
        st.selecting = false;
        st.hoverIdx = -1;

        st.vsX = GetSystemMetrics(SM_XVIRTUALSCREEN);
        st.vsY = GetSystemMetrics(SM_YVIRTUALSCREEN);
        st.vsW = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        st.vsH = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if (st.vsW <= 0 || st.vsH <= 0) {
            st.vsX = 0; st.vsY = 0;
            st.vsW = GetSystemMetrics(SM_CXSCREEN);
            st.vsH = GetSystemMetrics(SM_CYSCREEN);
        }

        // Enumerate windows for snapping (before we create our overlay)
        EnumWindows(RCEnumWinProc, (LPARAM)&st.winRects);

        // Capture virtual screen
        HDC hScrDC = GetDC(NULL);
        BITMAPINFOHEADER bi = {};
        bi.biSize = sizeof(bi);
        bi.biWidth = st.vsW;
        bi.biHeight = -st.vsH;
        bi.biPlanes = 1;
        bi.biBitCount = 32;
        bi.biCompression = BI_RGB;

        st.hOrigDC = CreateCompatibleDC(hScrDC);
        st.hOrigBmp = CreateDIBSection(st.hOrigDC, (BITMAPINFO*)&bi, DIB_RGB_COLORS, &st.pOrigBits, NULL, 0);
        st.hOldOrig = (HBITMAP)SelectObject(st.hOrigDC, st.hOrigBmp);
        BitBlt(st.hOrigDC, 0, 0, st.vsW, st.vsH, hScrDC, st.vsX, st.vsY, SRCCOPY);

        // Fix alpha channel: GDI BitBlt leaves alpha=0 (transparent).
        // Electron's nativeImage.createFromBitmap needs alpha=255 (opaque).
        size_t pixelCount = (size_t)st.vsW * st.vsH;
        uint32_t* src32 = (uint32_t*)st.pOrigBits;
        for (size_t i = 0; i < pixelCount; i++) {
            src32[i] |= 0xFF000000;  // Set alpha to 255
        }

        // Create dimmed version (optimized uint32 ops)
        st.hDimDC = CreateCompatibleDC(hScrDC);
        st.hDimBmp = CreateDIBSection(st.hDimDC, (BITMAPINFO*)&bi, DIB_RGB_COLORS, &st.pDimBits, NULL, 0);
        st.hOldDim = (HBITMAP)SelectObject(st.hDimDC, st.hDimBmp);

        uint32_t* dst32 = (uint32_t*)st.pDimBits;
        for (size_t i = 0; i < pixelCount; i++) {
            // Halve RGB, keep alpha=0xFF
            dst32[i] = ((src32[i] >> 1) & 0x007F7F7F) | 0xFF000000;
        }

        // Create double buffer
        st.hBackDC = CreateCompatibleDC(hScrDC);
        st.hBackBmp = CreateCompatibleBitmap(hScrDC, st.vsW, st.vsH);
        st.hOldBack = (HBITMAP)SelectObject(st.hBackDC, st.hBackBmp);

        ReleaseDC(NULL, hScrDC);

        st.hFont = CreateFontW(16, 0, 0, 0, FW_NORMAL, 0, 0, 0,
            DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
            CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Segoe UI");

        if (!g_rcClassRegistered) {
            WNDCLASSEXW wc = {};
            wc.cbSize = sizeof(wc);
            wc.lpfnWndProc = RCWndProc;
            wc.hInstance = GetModuleHandle(NULL);
            wc.hCursor = LoadCursor(NULL, IDC_CROSS);
            wc.lpszClassName = RC_CLASS;
            wc.style = CS_HREDRAW | CS_VREDRAW;
            RegisterClassExW(&wc);
            g_rcClassRegistered = true;
        }

        HWND hwnd = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            RC_CLASS, NULL,
            WS_POPUP | WS_VISIBLE,
            st.vsX, st.vsY, st.vsW, st.vsH,
            NULL, NULL, GetModuleHandle(NULL), &st
        );

        if (!hwnd) {
            SelectObject(st.hOrigDC, st.hOldOrig); DeleteObject(st.hOrigBmp); DeleteDC(st.hOrigDC);
            SelectObject(st.hDimDC, st.hOldDim); DeleteObject(st.hDimBmp); DeleteDC(st.hDimDC);
            SelectObject(st.hBackDC, st.hOldBack); DeleteObject(st.hBackBmp); DeleteDC(st.hBackDC);
            DeleteObject(st.hFont);
            auto* r = new RegionCaptureResult{false, 0,0,0,0, {}, 0,0};
            tsfn.BlockingCall(r, [](Napi::Env env, Napi::Function cb, RegionCaptureResult* d) {
                Napi::Object o = Napi::Object::New(env);
                o.Set("success", false);
                cb.Call({o});
                delete d;
            });
            tsfn.Release();
            g_rcActive = false;
            return;
        }

        SetForegroundWindow(hwnd);
        SetFocus(hwnd);

        MSG msg;
        while (GetMessage(&msg, NULL, 0, 0) > 0) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }

        // Prepare result
        auto* result = new RegionCaptureResult();
        result->success = st.success;
        if (st.success) {
            result->x = st.selL + st.vsX;
            result->y = st.selT + st.vsY;
            result->width = st.selW;
            result->height = st.selH;
            result->imageWidth = st.selW;
            result->imageHeight = st.selH;
            size_t rBytes = (size_t)st.selW * st.selH * 4;
            result->pixels.resize(rBytes);
            uint8_t* orig = (uint8_t*)st.pOrigBits;
            for (int y = 0; y < st.selH; y++) {
                memcpy(result->pixels.data() + y * st.selW * 4,
                       orig + ((st.selT + y) * st.vsW + st.selL) * 4,
                       st.selW * 4);
            }
        }

        // Cleanup GDI
        SelectObject(st.hOrigDC, st.hOldOrig); DeleteObject(st.hOrigBmp); DeleteDC(st.hOrigDC);
        SelectObject(st.hDimDC, st.hOldDim); DeleteObject(st.hDimBmp); DeleteDC(st.hDimDC);
        SelectObject(st.hBackDC, st.hOldBack); DeleteObject(st.hBackBmp); DeleteDC(st.hBackDC);
        DeleteObject(st.hFont);

        tsfn.BlockingCall(result, [](Napi::Env env, Napi::Function cb, RegionCaptureResult* d) {
            Napi::Object o = Napi::Object::New(env);
            o.Set("success", Napi::Boolean::New(env, d->success));
            if (d->success && !d->pixels.empty()) {
                o.Set("x", Napi::Number::New(env, d->x));
                o.Set("y", Napi::Number::New(env, d->y));
                o.Set("width", Napi::Number::New(env, d->width));
                o.Set("height", Napi::Number::New(env, d->height));
                auto buf = Napi::Buffer<uint8_t>::Copy(env, d->pixels.data(), d->pixels.size());
                o.Set("buffer", buf);
                o.Set("imageWidth", Napi::Number::New(env, d->imageWidth));
                o.Set("imageHeight", Napi::Number::New(env, d->imageHeight));
            }
            cb.Call({o});
            delete d;
        });
        tsfn.Release();
        g_rcActive = false;
    }).detach();

    return env.Undefined();
}

// ============================================================
// Windows: Native Realtime Color Picker
// ============================================================

struct ColorPickResult {
    bool success;
    int r, g, b;
};

static const wchar_t* CP_CLASS = L"MulbyRealtimeColorPick";
static bool g_cpClassRegistered = false;
static std::atomic<bool> g_cpActive{false};

struct CPState {
    HWND hwnd;
    HHOOK mouseHook;
    HHOOK keyboardHook;
    bool success;
    bool finished;
    bool initialButtonsReleased;
    bool hasSample;
    int x, y;
    int r, g, b;
    int vsX, vsY, vsW, vsH;
    int sampleSize;
    HDC hSampleDC;
    HBITMAP hSampleBmp;
    HBITMAP hOldSample;
    void* pSampleBits;
    HFONT hFont;
};

static CPState* g_cpState = nullptr;
static const UINT_PTR CP_TIMER_ID = 1;
static const UINT CP_TIMER_INTERVAL_MS = 16;

static int CPClampInt(int value, int minValue, int maxValue) {
    if (maxValue < minValue) return minValue;
    if (value < minValue) return minValue;
    if (value > maxValue) return maxValue;
    return value;
}

static void CPPlaceWindow(CPState* s) {
    if (!s || !s->hwnd) return;

    const int winW = 220;
    const int winH = 176;
    const int offset = 28;
    const int vsRight = s->vsX + s->vsW;
    const int vsBottom = s->vsY + s->vsH;

    int wx = s->x + offset;
    int wy = s->y + offset;

    if (wx + winW > vsRight) {
        wx = s->x - offset - winW;
    }
    if (wy + winH > vsBottom) {
        wy = s->y - offset - winH;
    }

    wx = CPClampInt(wx, s->vsX, vsRight - winW);
    wy = CPClampInt(wy, s->vsY, vsBottom - winH);

    SetWindowPos(
        s->hwnd,
        HWND_TOPMOST,
        wx,
        wy,
        winW,
        winH,
        SWP_NOACTIVATE | SWP_SHOWWINDOW
    );
}

static void CPUpdateSample(CPState* s, int x, int y) {
    if (!s || s->finished) return;

    s->x = x;
    s->y = y;

    // Move the preview away before sampling, so the picker never reads itself.
    CPPlaceWindow(s);

    HDC hdc = GetDC(NULL);
    if (!hdc) return;

    COLORREF color = GetPixel(hdc, x, y);
    if (color != CLR_INVALID) {
        s->r = GetRValue(color);
        s->g = GetGValue(color);
        s->b = GetBValue(color);
    }

    if (s->hSampleDC && s->pSampleBits) {
        int half = s->sampleSize / 2;
        BitBlt(
            s->hSampleDC,
            0,
            0,
            s->sampleSize,
            s->sampleSize,
            hdc,
            x - half,
            y - half,
            SRCCOPY
        );
    }

    ReleaseDC(NULL, hdc);

    if (s->hwnd) {
        InvalidateRect(s->hwnd, NULL, FALSE);
    }
}

static void CPFinish(CPState* s, bool success) {
    if (!s || s->finished) return;
    s->success = success;
    s->finished = true;
    if (s->hwnd) {
        PostMessageW(s->hwnd, WM_CLOSE, 0, 0);
    } else {
        PostQuitMessage(0);
    }
}

static bool CPIsKeyDown(int vk) {
    return (GetAsyncKeyState(vk) & 0x8000) != 0;
}

static LRESULT CALLBACK CPClickHookProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0 && g_cpState && g_cpState->initialButtonsReleased && !g_cpState->finished) {
        MSLLHOOKSTRUCT* mouse = reinterpret_cast<MSLLHOOKSTRUCT*>(lParam);
        if (mouse) {
            switch (wParam) {
            case WM_LBUTTONDOWN:
                CPUpdateSample(g_cpState, mouse->pt.x, mouse->pt.y);
                CPFinish(g_cpState, true);
                return 1;
            case WM_RBUTTONDOWN:
            case WM_MBUTTONDOWN:
                CPFinish(g_cpState, false);
                return 1;
            default:
                break;
            }
        }
    }

    return CallNextHookEx(g_cpState ? g_cpState->mouseHook : NULL, nCode, wParam, lParam);
}

static LRESULT CALLBACK CPKeyboardHookProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0 && g_cpState && !g_cpState->finished && (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN)) {
        KBDLLHOOKSTRUCT* key = reinterpret_cast<KBDLLHOOKSTRUCT*>(lParam);
        if (key && key->vkCode == VK_ESCAPE) {
            CPFinish(g_cpState, false);
            return 1;
        }
    }

    return CallNextHookEx(g_cpState ? g_cpState->keyboardHook : NULL, nCode, wParam, lParam);
}

static void CPTick(CPState* s) {
    if (!s || s->finished) return;

    const bool leftDown = CPIsKeyDown(VK_LBUTTON);
    const bool rightDown = CPIsKeyDown(VK_RBUTTON);
    const bool middleDown = CPIsKeyDown(VK_MBUTTON);
    const bool escapeDown = CPIsKeyDown(VK_ESCAPE);

    if (!s->initialButtonsReleased) {
        s->initialButtonsReleased = !leftDown && !rightDown && !middleDown && !escapeDown;
    } else {
        if ((escapeDown && !s->keyboardHook) || ((rightDown || middleDown) && !s->mouseHook)) {
            CPFinish(s, false);
            return;
        }

        // If hook installation fails, keep polling as a fallback. In that case
        // the underlying app may still receive the click, but picking remains usable.
        if (leftDown && !s->mouseHook) {
            POINT pt;
            if (GetCursorPos(&pt)) {
                CPUpdateSample(s, pt.x, pt.y);
            }
            CPFinish(s, true);
            return;
        }
    }

    POINT pt;
    if (!GetCursorPos(&pt)) return;
    if (!s->hasSample || pt.x != s->x || pt.y != s->y) {
        s->hasSample = true;
        CPUpdateSample(s, pt.x, pt.y);
    }
}

static void CPPaintTo(HDC hdc, CPState* s) {
    if (!s) return;

    RECT client;
    GetClientRect(s->hwnd, &client);

    HBRUSH bg = CreateSolidBrush(RGB(18, 18, 22));
    FillRect(hdc, &client, bg);
    DeleteObject(bg);

    HPEN borderPen = CreatePen(PS_SOLID, 1, RGB(70, 70, 78));
    HPEN oldPen = (HPEN)SelectObject(hdc, borderPen);
    HBRUSH oldBrush = (HBRUSH)SelectObject(hdc, GetStockObject(NULL_BRUSH));
    Rectangle(hdc, client.left, client.top, client.right, client.bottom);
    SelectObject(hdc, oldPen);
    SelectObject(hdc, oldBrush);
    DeleteObject(borderPen);

    const int zoomX = 12;
    const int zoomY = 12;
    const int cell = 8;
    const int zoomSize = s->sampleSize * cell;

    if (s->hSampleDC && s->pSampleBits) {
        int oldStretchMode = SetStretchBltMode(hdc, COLORONCOLOR);
        StretchBlt(
            hdc,
            zoomX,
            zoomY,
            zoomSize,
            zoomSize,
            s->hSampleDC,
            0,
            0,
            s->sampleSize,
            s->sampleSize,
            SRCCOPY
        );
        SetStretchBltMode(hdc, oldStretchMode);
    }

    HPEN gridPen = CreatePen(PS_SOLID, 1, RGB(40, 40, 48));
    oldPen = (HPEN)SelectObject(hdc, gridPen);
    for (int i = 0; i <= s->sampleSize; i++) {
        int p = zoomX + i * cell;
        MoveToEx(hdc, p, zoomY, NULL);
        LineTo(hdc, p, zoomY + zoomSize);
        p = zoomY + i * cell;
        MoveToEx(hdc, zoomX, p, NULL);
        LineTo(hdc, zoomX + zoomSize, p);
    }
    SelectObject(hdc, oldPen);
    DeleteObject(gridPen);

    int center = s->sampleSize / 2;
    HPEN centerPen = CreatePen(PS_SOLID, 2, RGB(255, 255, 255));
    oldPen = (HPEN)SelectObject(hdc, centerPen);
    oldBrush = (HBRUSH)SelectObject(hdc, GetStockObject(NULL_BRUSH));
    Rectangle(
        hdc,
        zoomX + center * cell,
        zoomY + center * cell,
        zoomX + (center + 1) * cell,
        zoomY + (center + 1) * cell
    );
    SelectObject(hdc, oldPen);
    SelectObject(hdc, oldBrush);
    DeleteObject(centerPen);

    RECT swatch = {150, 16, 204, 70};
    HBRUSH swatchBrush = CreateSolidBrush(RGB(s->r, s->g, s->b));
    FillRect(hdc, &swatch, swatchBrush);
    DeleteObject(swatchBrush);
    HPEN swatchPen = CreatePen(PS_SOLID, 1, RGB(220, 220, 220));
    oldPen = (HPEN)SelectObject(hdc, swatchPen);
    oldBrush = (HBRUSH)SelectObject(hdc, GetStockObject(NULL_BRUSH));
    Rectangle(hdc, swatch.left, swatch.top, swatch.right, swatch.bottom);
    SelectObject(hdc, oldPen);
    SelectObject(hdc, oldBrush);
    DeleteObject(swatchPen);

    wchar_t hexText[16];
    swprintf_s(hexText, L"#%02X%02X%02X", s->r, s->g, s->b);
    wchar_t rgbText[64];
    swprintf_s(rgbText, L"rgb(%d, %d, %d)", s->r, s->g, s->b);
    wchar_t tipText[] = L"Click to pick, ESC/right click to cancel";

    HFONT oldFont = (HFONT)SelectObject(hdc, s->hFont);
    SetBkMode(hdc, TRANSPARENT);
    SetTextColor(hdc, RGB(255, 255, 255));
    TextOutW(hdc, 150, 82, hexText, (int)wcslen(hexText));
    SetTextColor(hdc, RGB(205, 205, 212));
    TextOutW(hdc, 150, 108, rgbText, (int)wcslen(rgbText));
    SetTextColor(hdc, RGB(150, 150, 160));
    TextOutW(hdc, 12, 148, tipText, (int)wcslen(tipText));
    SelectObject(hdc, oldFont);
}

static LRESULT CALLBACK CPWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    CPState* s = (CPState*)GetWindowLongPtr(hwnd, GWLP_USERDATA);

    switch (msg) {
    case WM_CREATE: {
        CREATESTRUCT* cs = (CREATESTRUCT*)lParam;
        SetWindowLongPtr(hwnd, GWLP_USERDATA, (LONG_PTR)cs->lpCreateParams);
        return 0;
    }
    case WM_TIMER:
        if (wParam == CP_TIMER_ID) CPTick(s);
        return 0;
    case WM_MOUSEACTIVATE:
        return MA_NOACTIVATE;
    case WM_ERASEBKGND:
        return 1;
    case WM_PAINT: {
        if (!s) break;
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        CPPaintTo(hdc, s);
        EndPaint(hwnd, &ps);
        return 0;
    }
    case WM_CLOSE:
        DestroyWindow(hwnd);
        return 0;
    case WM_DESTROY:
        KillTimer(hwnd, CP_TIMER_ID);
        if (s) s->hwnd = NULL;
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProc(hwnd, msg, wParam, lParam);
}

static Napi::Value StartColorPick(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function required").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    if (g_cpActive.exchange(true)) {
        Napi::Error::New(env, "Color pick already in progress").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto tsfn = Napi::ThreadSafeFunction::New(
        env, info[0].As<Napi::Function>(),
        "ColorPickCB", 0, 1
    );

    std::thread([tsfn]() mutable {
        CPState st = {};
        st.success = false;
        st.finished = false;
        st.initialButtonsReleased = false;
        st.hasSample = false;
        st.sampleSize = 15;
        st.r = 0; st.g = 0; st.b = 0;
        st.vsX = GetSystemMetrics(SM_XVIRTUALSCREEN);
        st.vsY = GetSystemMetrics(SM_YVIRTUALSCREEN);
        st.vsW = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        st.vsH = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if (st.vsW <= 0 || st.vsH <= 0) {
            st.vsX = 0; st.vsY = 0;
            st.vsW = GetSystemMetrics(SM_CXSCREEN);
            st.vsH = GetSystemMetrics(SM_CYSCREEN);
        }

        HDC hdc = GetDC(NULL);
        BITMAPINFOHEADER bi = {};
        bi.biSize = sizeof(bi);
        bi.biWidth = st.sampleSize;
        bi.biHeight = -st.sampleSize;
        bi.biPlanes = 1;
        bi.biBitCount = 32;
        bi.biCompression = BI_RGB;

        st.hSampleDC = CreateCompatibleDC(hdc);
        st.hSampleBmp = CreateDIBSection(st.hSampleDC, (BITMAPINFO*)&bi, DIB_RGB_COLORS, &st.pSampleBits, NULL, 0);
        st.hOldSample = (HBITMAP)SelectObject(st.hSampleDC, st.hSampleBmp);
        ReleaseDC(NULL, hdc);

        st.hFont = CreateFontW(15, 0, 0, 0, FW_NORMAL, 0, 0, 0,
            DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
            CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Segoe UI");

        if (!g_cpClassRegistered) {
            WNDCLASSEXW wc = {};
            wc.cbSize = sizeof(wc);
            wc.lpfnWndProc = CPWndProc;
            wc.hInstance = GetModuleHandle(NULL);
            wc.hCursor = LoadCursor(NULL, IDC_CROSS);
            wc.lpszClassName = CP_CLASS;
            wc.style = CS_HREDRAW | CS_VREDRAW;
            RegisterClassExW(&wc);
            g_cpClassRegistered = true;
        }

        st.hwnd = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            CP_CLASS, NULL,
            WS_POPUP,
            st.vsX, st.vsY, 220, 176,
            NULL, NULL, GetModuleHandle(NULL), &st
        );

        if (!st.hwnd || !st.hSampleDC || !st.hSampleBmp) {
            auto* r = new ColorPickResult{false, 0, 0, 0};
            tsfn.BlockingCall(r, [](Napi::Env env, Napi::Function cb, ColorPickResult* d) {
                Napi::Object o = Napi::Object::New(env);
                o.Set("success", false);
                cb.Call({o});
                delete d;
            });
            if (st.hwnd) DestroyWindow(st.hwnd);
            if (st.hSampleDC && st.hOldSample) SelectObject(st.hSampleDC, st.hOldSample);
            if (st.hSampleBmp) DeleteObject(st.hSampleBmp);
            if (st.hSampleDC) DeleteDC(st.hSampleDC);
            if (st.hFont) DeleteObject(st.hFont);
            tsfn.Release();
            g_cpActive = false;
            return;
        }

        g_cpState = &st;
        st.mouseHook = SetWindowsHookExW(WH_MOUSE_LL, CPClickHookProc, GetModuleHandle(NULL), 0);
        st.keyboardHook = SetWindowsHookExW(WH_KEYBOARD_LL, CPKeyboardHookProc, GetModuleHandle(NULL), 0);

        POINT pt;
        GetCursorPos(&pt);
        CPUpdateSample(&st, pt.x, pt.y);
        st.hasSample = true;
        SetTimer(st.hwnd, CP_TIMER_ID, CP_TIMER_INTERVAL_MS, NULL);

        MSG msg;
        while (GetMessage(&msg, NULL, 0, 0) > 0) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }

        if (st.mouseHook) UnhookWindowsHookEx(st.mouseHook);
        if (st.keyboardHook) UnhookWindowsHookEx(st.keyboardHook);
        g_cpState = nullptr;

        auto* result = new ColorPickResult{st.success, st.r, st.g, st.b};

        if (st.hSampleDC && st.hOldSample) SelectObject(st.hSampleDC, st.hOldSample);
        if (st.hSampleBmp) DeleteObject(st.hSampleBmp);
        if (st.hSampleDC) DeleteDC(st.hSampleDC);
        if (st.hFont) DeleteObject(st.hFont);

        tsfn.BlockingCall(result, [](Napi::Env env, Napi::Function cb, ColorPickResult* d) {
            Napi::Object o = Napi::Object::New(env);
            o.Set("success", Napi::Boolean::New(env, d->success));
            if (d->success) {
                o.Set("r", Napi::Number::New(env, d->r));
                o.Set("g", Napi::Number::New(env, d->g));
                o.Set("b", Napi::Number::New(env, d->b));
            }
            cb.Call({o});
            delete d;
        });
        tsfn.Release();
        g_cpActive = false;
    }).detach();

    return env.Undefined();
}

#endif // _WIN32

// ============================================================
// Linux 实现
// ============================================================
#ifdef __linux__
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <cstring>
#include <vector>

/**
 * 将 XImage 转换为 BGRA Buffer
 * XImage 的像素格式可能是 BGRA 或 RGBA，需要统一为 BGRA
 */
static Napi::Object XImageToNapiResult(Napi::Env env, XImage* image) {
    if (!image) {
        Napi::Error::New(env, "截图失败: XImage 为空").ThrowAsJavaScriptException();
        return Napi::Object::New(env);
    }

    int width = image->width;
    int height = image->height;
    size_t totalBytes = (size_t)width * height * 4;

    std::vector<uint8_t> bgra(totalBytes);

    for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
            unsigned long pixel = XGetPixel(image, x, y);
            size_t idx = ((size_t)y * width + x) * 4;

            // XImage 像素格式（通常是 0xAARRGGBB）→ BGRA
            bgra[idx + 0] = (pixel >>  0) & 0xFF;  // B
            bgra[idx + 1] = (pixel >>  8) & 0xFF;  // G
            bgra[idx + 2] = (pixel >> 16) & 0xFF;  // R
            bgra[idx + 3] = 0xFF;                   // A (不透明)
        }
    }

    auto buffer = Napi::Buffer<uint8_t>::Copy(env, bgra.data(), totalBytes);

    Napi::Object result = Napi::Object::New(env);
    result.Set("buffer", buffer);
    result.Set("width", Napi::Number::New(env, width));
    result.Set("height", Napi::Number::New(env, height));

    return result;
}

/**
 * captureScreen(displayIndex?: number) → { buffer, width, height }
 *
 * Linux: 截取整个 root window（多屏情况下 root window 覆盖所有屏幕）
 * displayIndex 参数在 Linux 单屏场景下忽略，多屏会按 Xinerama/XRandR 信息裁剪。
 * 简化实现：直接截取整个 root window。
 */
static Napi::Value CaptureScreen(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    Display* display = XOpenDisplay(nullptr);
    if (!display) {
        Napi::Error::New(env, "截图失败: 无法连接 X11 显示器").ThrowAsJavaScriptException();
        return env.Null();
    }

    Window root = DefaultRootWindow(display);
    XWindowAttributes attrs;
    XGetWindowAttributes(display, root, &attrs);

    int x = 0, y = 0;
    int width = attrs.width;
    int height = attrs.height;

    // 如果指定了 displayIndex，尝试使用 XRandR 获取特定屏幕的区域
    // TODO: 多屏支持需要 libXrandr，这里先截取整个桌面
    uint32_t displayIndex = 0;
    if (info.Length() > 0 && info[0].IsNumber()) {
        displayIndex = info[0].As<Napi::Number>().Uint32Value();
    }

    // 对于多 screen 的 X11，使用 ScreenCount + ScreenOfDisplay
    if (displayIndex > 0 && (int)displayIndex < ScreenCount(display)) {
        Screen* screen = ScreenOfDisplay(display, displayIndex);
        if (screen) {
            width = screen->width;
            height = screen->height;
        }
    }

    XImage* image = XGetImage(display, root, x, y, width, height, AllPlanes, ZPixmap);

    if (!image) {
        XCloseDisplay(display);
        Napi::Error::New(env, "截图失败: XGetImage 返回空").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Object result = XImageToNapiResult(env, image);

    XDestroyImage(image);
    XCloseDisplay(display);

    return result;
}

/**
 * captureRegion(x, y, width, height) → { buffer, width, height }
 */
static Napi::Value CaptureRegion(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 4) {
        Napi::TypeError::New(env, "需要 4 个参数: x, y, width, height").ThrowAsJavaScriptException();
        return env.Null();
    }

    int rx = info[0].As<Napi::Number>().Int32Value();
    int ry = info[1].As<Napi::Number>().Int32Value();
    int rw = info[2].As<Napi::Number>().Int32Value();
    int rh = info[3].As<Napi::Number>().Int32Value();

    if (rw <= 0 || rh <= 0) {
        Napi::TypeError::New(env, "width 和 height 必须大于 0").ThrowAsJavaScriptException();
        return env.Null();
    }

    Display* display = XOpenDisplay(nullptr);
    if (!display) {
        Napi::Error::New(env, "截图失败: 无法连接 X11 显示器").ThrowAsJavaScriptException();
        return env.Null();
    }

    Window root = DefaultRootWindow(display);
    XImage* image = XGetImage(display, root, rx, ry, rw, rh, AllPlanes, ZPixmap);

    if (!image) {
        XCloseDisplay(display);
        Napi::Error::New(env, "区域截图失败: XGetImage 返回空").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Object result = XImageToNapiResult(env, image);

    XDestroyImage(image);
    XCloseDisplay(display);

    return result;
}

/**
 * getPixelColor(x, y) → { r, g, b }
 */
static Napi::Value GetPixelColor(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "需要 2 个参数: x, y").ThrowAsJavaScriptException();
        return env.Null();
    }

    int x = info[0].As<Napi::Number>().Int32Value();
    int y = info[1].As<Napi::Number>().Int32Value();

    Display* display = XOpenDisplay(nullptr);
    if (!display) {
        Napi::Error::New(env, "取色失败: 无法连接 X11 显示器").ThrowAsJavaScriptException();
        return env.Null();
    }

    Window root = DefaultRootWindow(display);
    XImage* image = XGetImage(display, root, x, y, 1, 1, AllPlanes, ZPixmap);

    Napi::Object result = Napi::Object::New(env);

    if (image) {
        unsigned long pixel = XGetPixel(image, 0, 0);
        result.Set("r", Napi::Number::New(env, (pixel >> 16) & 0xFF));
        result.Set("g", Napi::Number::New(env, (pixel >> 8) & 0xFF));
        result.Set("b", Napi::Number::New(env, pixel & 0xFF));
        XDestroyImage(image);
    } else {
        result.Set("r", Napi::Number::New(env, 0));
        result.Set("g", Napi::Number::New(env, 0));
        result.Set("b", Napi::Number::New(env, 0));
    }

    XCloseDisplay(display);
    return result;
}

/**
 * getDisplays() → Array<{ id, x, y, width, height, scaleFactor }>
 */
static Napi::Value GetDisplays(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    Display* display = XOpenDisplay(nullptr);
    if (!display) {
        return Napi::Array::New(env, 0);
    }

    int screenCount = ScreenCount(display);
    Napi::Array result = Napi::Array::New(env, screenCount);

    for (int i = 0; i < screenCount; i++) {
        Screen* screen = ScreenOfDisplay(display, i);
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("id", Napi::Number::New(env, i));
        obj.Set("x", Napi::Number::New(env, 0));
        obj.Set("y", Napi::Number::New(env, 0));
        obj.Set("width", Napi::Number::New(env, screen->width));
        obj.Set("height", Napi::Number::New(env, screen->height));
        obj.Set("scaleFactor", Napi::Number::New(env, 1.0)); // Linux 的 scale 通常由 compositor 管理
        result.Set(static_cast<uint32_t>(i), obj);
    }

    XCloseDisplay(display);
    return result;
}

#endif // __linux__

// ============================================================
// N-API 模块导出（Windows & Linux 共用）
// ============================================================
#if defined(_WIN32) || defined(__linux__)

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("captureScreen", Napi::Function::New(env, CaptureScreen));
    exports.Set("captureRegion", Napi::Function::New(env, CaptureRegion));
    exports.Set("getPixelColor", Napi::Function::New(env, GetPixelColor));
    exports.Set("getDisplays", Napi::Function::New(env, GetDisplays));
#ifdef _WIN32
    exports.Set("startRegionCapture", Napi::Function::New(env, StartRegionCapture));
    exports.Set("startColorPick", Napi::Function::New(env, StartColorPick));
#endif
    return exports;
}

NODE_API_MODULE(screen_capture, Init)

#endif
