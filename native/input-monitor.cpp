/**
 * input-monitor.cpp — Windows / Linux 全局输入事件监听模块
 *
 * Windows: SetWindowsHookEx (WH_MOUSE_LL + WH_KEYBOARD_LL)
 * Linux: XRecord 扩展 (X11)
 *
 * 回调格式与 macOS 版 (input-monitor.mm) 完全一致。
 */

#include <napi.h>

#ifdef _WIN32
#include <windows.h>
#include <thread>
#include <atomic>
#include <string>
#include <chrono>
#include <mutex>

// Windows 虚拟键码 → 可读键名
static std::string vkToName(DWORD vk) {
    switch (vk) {
        case VK_RETURN:    return "Enter";
        case VK_TAB:       return "Tab";
        case VK_SPACE:     return "Space";
        case VK_BACK:      return "Backspace";
        case VK_ESCAPE:    return "Escape";
        case VK_DELETE:    return "Delete";
        case VK_UP:        return "ArrowUp";
        case VK_DOWN:      return "ArrowDown";
        case VK_LEFT:      return "ArrowLeft";
        case VK_RIGHT:     return "ArrowRight";
        case VK_HOME:      return "Home";
        case VK_END:       return "End";
        case VK_PRIOR:     return "PageUp";
        case VK_NEXT:      return "PageDown";
        case VK_INSERT:    return "Insert";
        case VK_CAPITAL:   return "CapsLock";
        case VK_SHIFT:
        case VK_LSHIFT:
        case VK_RSHIFT:    return "Shift";
        case VK_CONTROL:
        case VK_LCONTROL:
        case VK_RCONTROL:  return "Control";
        case VK_MENU:
        case VK_LMENU:
        case VK_RMENU:     return "Alt";
        case VK_LWIN:
        case VK_RWIN:      return "Meta";
        case VK_F1:  return "F1";  case VK_F2:  return "F2";
        case VK_F3:  return "F3";  case VK_F4:  return "F4";
        case VK_F5:  return "F5";  case VK_F6:  return "F6";
        case VK_F7:  return "F7";  case VK_F8:  return "F8";
        case VK_F9:  return "F9";  case VK_F10: return "F10";
        case VK_F11: return "F11"; case VK_F12: return "F12";
        default: {
            if ((vk >= 0x30 && vk <= 0x39) || (vk >= 0x41 && vk <= 0x5A)) {
                char c = static_cast<char>(vk);
                if (c >= 'A' && c <= 'Z') c = c - 'A' + 'a';
                return std::string(1, c);
            }
            return "";
        }
    }
}

// 全局 InputMonitor 实例指针（Windows 钩子回调需要静态函数）
class InputMonitor;
static InputMonitor* g_instance = nullptr;

class InputMonitor : public Napi::ObjectWrap<InputMonitor> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    InputMonitor(const Napi::CallbackInfo& info);
    ~InputMonitor();

private:
    static Napi::FunctionReference constructor;

    Napi::Value Start(const Napi::CallbackInfo& info);
    Napi::Value Stop(const Napi::CallbackInfo& info);
    Napi::Value IsRunning(const Napi::CallbackInfo& info);

    void StartMonitoring(bool mouse, bool keyboard, int throttleMs);
    void StopMonitoring();

    static LRESULT CALLBACK LowLevelMouseProc(int nCode, WPARAM wParam, LPARAM lParam);
    static LRESULT CALLBACK LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam);

    void EmitEvent(const std::string& type, double x, double y,
                   const std::string& button, int clickCount,
                   double scrollDx, double scrollDy,
                   int keyCode, const std::string& key,
                   bool shift, bool ctrl, bool alt, bool meta);

    Napi::ThreadSafeFunction tsfn_;
    std::atomic<bool> running_{false};
    bool monitorMouse_ = true;
    bool monitorKeyboard_ = true;
    int throttleMs_ = 16;

    HHOOK mouseHook_ = nullptr;
    HHOOK keyboardHook_ = nullptr;
    std::thread hookThread_;
    DWORD hookThreadId_ = 0;
    HANDLE threadReady_ = nullptr;

    std::atomic<int64_t> lastMoveTs_{0};
};

Napi::FunctionReference InputMonitor::constructor;

InputMonitor::InputMonitor(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<InputMonitor>(info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function expected").ThrowAsJavaScriptException();
        return;
    }
    tsfn_ = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(),
                                           "InputMonitorCallback", 0, 1);
}

InputMonitor::~InputMonitor() {
    StopMonitoring();
    if (tsfn_) tsfn_.Release();
}

LRESULT CALLBACK InputMonitor::LowLevelMouseProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0 && g_instance && g_instance->running_.load() && g_instance->monitorMouse_) {
        auto* ms = reinterpret_cast<MSLLHOOKSTRUCT*>(lParam);
        double x = static_cast<double>(ms->pt.x);
        double y = static_cast<double>(ms->pt.y);
        bool shift = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
        bool ctrl  = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;
        bool alt   = (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;
        bool meta  = (GetAsyncKeyState(VK_LWIN) & 0x8000) || (GetAsyncKeyState(VK_RWIN) & 0x8000);

        switch (wParam) {
            case WM_MOUSEMOVE: {
                auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::steady_clock::now().time_since_epoch()).count();
                auto last = g_instance->lastMoveTs_.load();
                if (now - last < g_instance->throttleMs_) break;
                g_instance->lastMoveTs_.store(now);
                g_instance->EmitEvent("mouseMove", x, y, "", 0, 0, 0, -1, "",
                                      shift, ctrl, alt, meta);
                break;
            }
            case WM_LBUTTONDOWN:
                g_instance->EmitEvent("mouseDown", x, y, "left", 1, 0, 0, -1, "",
                                      shift, ctrl, alt, meta);
                break;
            case WM_LBUTTONUP:
                g_instance->EmitEvent("mouseUp", x, y, "left", 0, 0, 0, -1, "",
                                      shift, ctrl, alt, meta);
                break;
            case WM_RBUTTONDOWN:
                g_instance->EmitEvent("mouseDown", x, y, "right", 1, 0, 0, -1, "",
                                      shift, ctrl, alt, meta);
                break;
            case WM_RBUTTONUP:
                g_instance->EmitEvent("mouseUp", x, y, "right", 0, 0, 0, -1, "",
                                      shift, ctrl, alt, meta);
                break;
            case WM_MBUTTONDOWN:
                g_instance->EmitEvent("mouseDown", x, y, "middle", 1, 0, 0, -1, "",
                                      shift, ctrl, alt, meta);
                break;
            case WM_MBUTTONUP:
                g_instance->EmitEvent("mouseUp", x, y, "middle", 0, 0, 0, -1, "",
                                      shift, ctrl, alt, meta);
                break;
            case WM_MOUSEWHEEL: {
                short delta = GET_WHEEL_DELTA_WPARAM(ms->mouseData);
                g_instance->EmitEvent("mouseScroll", x, y, "", 0, 0,
                                      static_cast<double>(delta) / WHEEL_DELTA,
                                      -1, "", shift, ctrl, alt, meta);
                break;
            }
        }
    }
    return CallNextHookEx(nullptr, nCode, wParam, lParam);
}

LRESULT CALLBACK InputMonitor::LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0 && g_instance && g_instance->running_.load() && g_instance->monitorKeyboard_) {
        auto* kb = reinterpret_cast<KBDLLHOOKSTRUCT*>(lParam);
        POINT pt;
        GetCursorPos(&pt);
        bool shift = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
        bool ctrl  = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;
        bool alt   = (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;
        bool meta  = (GetAsyncKeyState(VK_LWIN) & 0x8000) || (GetAsyncKeyState(VK_RWIN) & 0x8000);
        std::string key = vkToName(kb->vkCode);
        std::string type = (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN) ? "keyDown" : "keyUp";
        g_instance->EmitEvent(type, pt.x, pt.y, "", 0, 0, 0,
                              static_cast<int>(kb->vkCode), key,
                              shift, ctrl, alt, meta);
    }
    return CallNextHookEx(nullptr, nCode, wParam, lParam);
}

void InputMonitor::EmitEvent(const std::string& type, double x, double y,
                              const std::string& button, int clickCount,
                              double scrollDx, double scrollDy,
                              int keyCode, const std::string& key,
                              bool shift, bool ctrl, bool alt, bool meta) {
    double timestamp = static_cast<double>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count());

    tsfn_.NonBlockingCall(
        [type, timestamp, x, y, button, clickCount, scrollDx, scrollDy,
         keyCode, key, shift, ctrl, alt, meta]
        (Napi::Env env, Napi::Function callback) {
            Napi::Object obj = Napi::Object::New(env);
            obj.Set("type", Napi::String::New(env, type));
            obj.Set("timestamp", Napi::Number::New(env, timestamp));
            obj.Set("x", Napi::Number::New(env, x));
            obj.Set("y", Napi::Number::New(env, y));
            if (!button.empty()) obj.Set("button", Napi::String::New(env, button));
            if (clickCount > 0) obj.Set("clickCount", Napi::Number::New(env, clickCount));
            if (type == "mouseScroll") {
                obj.Set("scrollDeltaX", Napi::Number::New(env, scrollDx));
                obj.Set("scrollDeltaY", Napi::Number::New(env, scrollDy));
            }
            if (keyCode >= 0) obj.Set("keyCode", Napi::Number::New(env, keyCode));
            if (!key.empty()) obj.Set("key", Napi::String::New(env, key));
            obj.Set("shift", Napi::Boolean::New(env, shift));
            obj.Set("ctrl", Napi::Boolean::New(env, ctrl));
            obj.Set("alt", Napi::Boolean::New(env, alt));
            obj.Set("meta", Napi::Boolean::New(env, meta));
            callback.Call({obj});
        }
    );
}

void InputMonitor::StartMonitoring(bool mouse, bool keyboard, int throttleMs) {
    if (running_.load()) return;
    monitorMouse_ = mouse;
    monitorKeyboard_ = keyboard;
    throttleMs_ = throttleMs;
    running_.store(true);
    g_instance = this;

    // Event signaled once the hook thread's message queue is ready
    threadReady_ = CreateEvent(nullptr, TRUE, FALSE, nullptr);

    hookThread_ = std::thread([this, mouse, keyboard]() {
        hookThreadId_ = GetCurrentThreadId();
        if (mouse) {
            mouseHook_ = SetWindowsHookExW(WH_MOUSE_LL, LowLevelMouseProc, nullptr, 0);
        }
        if (keyboard) {
            keyboardHook_ = SetWindowsHookExW(WH_KEYBOARD_LL, LowLevelKeyboardProc, nullptr, 0);
        }
        // Force message queue creation, then signal readiness
        MSG initMsg;
        PeekMessage(&initMsg, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
        SetEvent(threadReady_);

        MSG msg;
        while (GetMessage(&msg, nullptr, 0, 0) > 0) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
        if (mouseHook_) { UnhookWindowsHookEx(mouseHook_); mouseHook_ = nullptr; }
        if (keyboardHook_) { UnhookWindowsHookEx(keyboardHook_); keyboardHook_ = nullptr; }
    });

    // Wait up to 5 s for the hook thread to be ready
    WaitForSingleObject(threadReady_, 5000);
    CloseHandle(threadReady_);
    threadReady_ = nullptr;
}

void InputMonitor::StopMonitoring() {
    if (!running_.load()) return;
    running_.store(false);
    DWORD tid = hookThreadId_;
    hookThreadId_ = 0;
    if (tid) {
        PostThreadMessage(tid, WM_QUIT, 0, 0);
    }
    if (hookThread_.joinable()) hookThread_.join();
    if (g_instance == this) g_instance = nullptr;
}

Napi::Value InputMonitor::Start(const Napi::CallbackInfo& info) {
    bool mouse = true, keyboard = true;
    int throttleMs = 16;
    if (info.Length() > 0 && info[0].IsObject()) {
        Napi::Object opts = info[0].As<Napi::Object>();
        if (opts.Has("mouse") && opts.Get("mouse").IsBoolean())
            mouse = opts.Get("mouse").As<Napi::Boolean>().Value();
        if (opts.Has("keyboard") && opts.Get("keyboard").IsBoolean())
            keyboard = opts.Get("keyboard").As<Napi::Boolean>().Value();
        if (opts.Has("throttleMs") && opts.Get("throttleMs").IsNumber())
            throttleMs = std::max(0, opts.Get("throttleMs").As<Napi::Number>().Int32Value());
    }
    StartMonitoring(mouse, keyboard, throttleMs);
    return info.Env().Undefined();
}

Napi::Value InputMonitor::Stop(const Napi::CallbackInfo& info) {
    StopMonitoring();
    return info.Env().Undefined();
}

Napi::Value InputMonitor::IsRunning(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), running_.load());
}

Napi::Object InputMonitor::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "InputMonitor", {
        InstanceMethod("start", &InputMonitor::Start),
        InstanceMethod("stop", &InputMonitor::Stop),
        InstanceMethod("isRunning", &InputMonitor::IsRunning)
    });
    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();
    exports.Set("InputMonitor", func);
    return exports;
}

#else
// ============================================================
// Linux 存根
// TODO: 实现 X11 环境下基于 XRecord/XInput2 的全局输入监听
// TODO: 实现 Wayland 环境下基于 libinput 的全局输入监听
// TODO: 需要处理 X11 与 Wayland 的运行时检测和分支
// ============================================================
class InputMonitor : public Napi::ObjectWrap<InputMonitor> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "InputMonitor", {
            InstanceMethod("start", &InputMonitor::Start),
            InstanceMethod("stop", &InputMonitor::Stop),
            InstanceMethod("isRunning", &InputMonitor::IsRunning)
        });
        constructor = Napi::Persistent(func);
        constructor.SuppressDestruct();
        exports.Set("InputMonitor", func);
        return exports;
    }
    InputMonitor(const Napi::CallbackInfo& info) : Napi::ObjectWrap<InputMonitor>(info) {}
private:
    static Napi::FunctionReference constructor;
    // TODO: 添加 XRecordContext、Display* 等 X11 资源成员
    // TODO: 添加 libinput 相关句柄成员 (Wayland)
    Napi::Value Start(const Napi::CallbackInfo& info) { return info.Env().Undefined(); }
    Napi::Value Stop(const Napi::CallbackInfo& info) { return info.Env().Undefined(); }
    Napi::Value IsRunning(const Napi::CallbackInfo& info) {
        return Napi::Boolean::New(info.Env(), false);
    }
};
Napi::FunctionReference InputMonitor::constructor;
#endif

// N-API 模块导出
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return InputMonitor::Init(env, exports);
}

NODE_API_MODULE(input_monitor, Init)
