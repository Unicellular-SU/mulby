#include <napi.h>

#ifdef __APPLE__
#include <AppKit/AppKit.h>
#endif

#ifdef _WIN32
#include <windows.h>
#endif

#ifdef __linux__
#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <thread>
#include <unistd.h>
#endif

class ClipboardWatcher : public Napi::ObjectWrap<ClipboardWatcher> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    ClipboardWatcher(const Napi::CallbackInfo& info);
    ~ClipboardWatcher();

private:
    static Napi::FunctionReference constructor;

    Napi::Value Start(const Napi::CallbackInfo& info);
    Napi::Value Stop(const Napi::CallbackInfo& info);

    void StartWatching();
    void StopWatching();
    void OnClipboardChange();

    Napi::ThreadSafeFunction tsfn;
    bool isWatching = false;

#ifdef __APPLE__
    NSInteger lastChangeCount = 0;
    dispatch_source_t timer = nullptr;
#endif

#ifdef _WIN32
    HWND hwnd = nullptr;
    HWND nextViewer = nullptr;
    static LRESULT CALLBACK WindowProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam);
#endif

#ifdef __linux__
    Display* display = nullptr;
    Window window;
    Atom clipboardAtom;
    bool running = false;
#endif
};

Napi::FunctionReference ClipboardWatcher::constructor;

// ============================================
// macOS Implementation
// ============================================
#ifdef __APPLE__

ClipboardWatcher::ClipboardWatcher(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<ClipboardWatcher>(info) {

    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function expected").ThrowAsJavaScriptException();
        return;
    }

    Napi::Function callback = info[0].As<Napi::Function>();

    // Create thread-safe function
    tsfn = Napi::ThreadSafeFunction::New(
        env,
        callback,
        "ClipboardWatcher",
        0,
        1
    );

    // Get initial change count
    lastChangeCount = [[NSPasteboard generalPasteboard] changeCount];
}

ClipboardWatcher::~ClipboardWatcher() {
    StopWatching();
    if (tsfn) {
        tsfn.Release();
    }
}

void ClipboardWatcher::StartWatching() {
    if (isWatching) return;
    isWatching = true;

    // Create a dispatch timer that checks every 100ms
    dispatch_queue_t queue = dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0);
    timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, queue);

    dispatch_source_set_timer(timer,
        dispatch_time(DISPATCH_TIME_NOW, 0),
        100 * NSEC_PER_MSEC,  // Check every 100ms
        10 * NSEC_PER_MSEC    // 10ms leeway
    );

    // Capture 'this' pointer
    ClipboardWatcher* self = this;

    dispatch_source_set_event_handler(timer, ^{
        NSInteger currentCount = [[NSPasteboard generalPasteboard] changeCount];

        if (currentCount != self->lastChangeCount) {
            self->lastChangeCount = currentCount;
            self->OnClipboardChange();
        }
    });

    dispatch_resume(timer);
}

void ClipboardWatcher::StopWatching() {
    if (!isWatching) return;
    isWatching = false;

    if (timer) {
        dispatch_source_cancel(timer);
        dispatch_release(timer);
        timer = nullptr;
    }
}

void ClipboardWatcher::OnClipboardChange() {
    if (tsfn) {
        tsfn.BlockingCall([](Napi::Env env, Napi::Function jsCallback) {
            jsCallback.Call({});
        });
    }
}

#endif

// ============================================
// Windows Implementation
// ============================================
#ifdef _WIN32

ClipboardWatcher::ClipboardWatcher(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<ClipboardWatcher>(info) {

    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function expected").ThrowAsJavaScriptException();
        return;
    }

    Napi::Function callback = info[0].As<Napi::Function>();

    tsfn = Napi::ThreadSafeFunction::New(
        env,
        callback,
        "ClipboardWatcher",
        0,
        1
    );
}

ClipboardWatcher::~ClipboardWatcher() {
    StopWatching();
    if (tsfn) {
        tsfn.Release();
    }
}

LRESULT CALLBACK ClipboardWatcher::WindowProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    ClipboardWatcher* self = reinterpret_cast<ClipboardWatcher*>(GetWindowLongPtr(hwnd, GWLP_USERDATA));

    switch (msg) {
        case WM_CHANGECBCHAIN:
            if ((HWND)wParam == self->nextViewer) {
                self->nextViewer = (HWND)lParam;
            } else if (self->nextViewer) {
                SendMessage(self->nextViewer, msg, wParam, lParam);
            }
            break;

        case WM_DRAWCLIPBOARD:
            self->OnClipboardChange();
            if (self->nextViewer) {
                SendMessage(self->nextViewer, msg, wParam, lParam);
            }
            break;

        default:
            return DefWindowProc(hwnd, msg, wParam, lParam);
    }

    return 0;
}

void ClipboardWatcher::StartWatching() {
    if (isWatching) return;
    isWatching = true;

    // Create a message-only window
    WNDCLASSA wc = {};
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = GetModuleHandle(nullptr);
    wc.lpszClassName = "ClipboardWatcherWindow";

    RegisterClassA(&wc);

    hwnd = CreateWindowA(
        "ClipboardWatcherWindow",
        "",
        0, 0, 0, 0, 0,
        HWND_MESSAGE,
        nullptr,
        GetModuleHandle(nullptr),
        nullptr
    );

    SetWindowLongPtr(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(this));

    // Add to clipboard viewer chain
    nextViewer = SetClipboardViewer(hwnd);
}

void ClipboardWatcher::StopWatching() {
    if (!isWatching) return;
    isWatching = false;

    if (hwnd) {
        ChangeClipboardChain(hwnd, nextViewer);
        DestroyWindow(hwnd);
        hwnd = nullptr;
    }
}

void ClipboardWatcher::OnClipboardChange() {
    if (tsfn) {
        tsfn.NonBlockingCall([](Napi::Env env, Napi::Function jsCallback) {
            jsCallback.Call({});
        });
    }
}

#endif

// ============================================
// Linux Implementation
// ============================================
#ifdef __linux__

ClipboardWatcher::ClipboardWatcher(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<ClipboardWatcher>(info) {

    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function expected").ThrowAsJavaScriptException();
        return;
    }

    Napi::Function callback = info[0].As<Napi::Function>();

    tsfn = Napi::ThreadSafeFunction::New(
        env,
        callback,
        "ClipboardWatcher",
        0,
        1
    );

    display = XOpenDisplay(nullptr);
    if (display) {
        window = XCreateSimpleWindow(display, DefaultRootWindow(display), 0, 0, 1, 1, 0, 0, 0);
        clipboardAtom = XInternAtom(display, "CLIPBOARD", False);
    }
}

ClipboardWatcher::~ClipboardWatcher() {
    StopWatching();
    if (display) {
        XDestroyWindow(display, window);
        XCloseDisplay(display);
    }
    if (tsfn) {
        tsfn.Release();
    }
}

void ClipboardWatcher::StartWatching() {
    if (isWatching || !display) return;
    isWatching = true;
    running = true;

    // Start event loop in separate thread
    std::thread([this]() {
        XEvent event;
        XSelectInput(display, window, PropertyChangeMask);

        while (running) {
            if (XPending(display)) {
                XNextEvent(display, &event);
                if (event.type == PropertyNotify) {
                    OnClipboardChange();
                }
            }
            usleep(10000); // 10ms
        }
    }).detach();
}

void ClipboardWatcher::StopWatching() {
    if (!isWatching) return;
    isWatching = false;
    running = false;
}

void ClipboardWatcher::OnClipboardChange() {
    if (tsfn) {
        tsfn.NonBlockingCall([](Napi::Env env, Napi::Function jsCallback) {
            jsCallback.Call({});
        });
    }
}

#endif

// ============================================
// Common N-API Bindings
// ============================================

Napi::Value ClipboardWatcher::Start(const Napi::CallbackInfo& info) {
    StartWatching();
    return info.Env().Undefined();
}

Napi::Value ClipboardWatcher::Stop(const Napi::CallbackInfo& info) {
    StopWatching();
    return info.Env().Undefined();
}

Napi::Object ClipboardWatcher::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "ClipboardWatcher", {
        InstanceMethod("start", &ClipboardWatcher::Start),
        InstanceMethod("stop", &ClipboardWatcher::Stop)
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("ClipboardWatcher", func);
    return exports;
}

// Module initialization
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return ClipboardWatcher::Init(env, exports);
}

NODE_API_MODULE(clipboard_watcher, Init)
