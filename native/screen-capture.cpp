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
    return exports;
}

NODE_API_MODULE(screen_capture, Init)

#endif
