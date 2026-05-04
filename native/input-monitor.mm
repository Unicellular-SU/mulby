/**
 * input-monitor.mm — macOS 全局输入事件监听模块
 *
 * API (ObjectWrap):
 *   new InputMonitor(callback)
 *   .start(options?) → void
 *   .stop() → void
 *
 * 使用 CGEventTap 监听全局鼠标和键盘事件（只监听不拦截）。
 * 需要辅助功能权限 (Accessibility)。
 *
 * 事件回调格式:
 *   { type, timestamp, x?, y?, button?, clickCount?, scrollDeltaX?, scrollDeltaY?,
 *     keyCode?, key?, shift?, ctrl?, alt?, meta? }
 */

#include <napi.h>

#ifdef __APPLE__
#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>
#import <CoreFoundation/CoreFoundation.h>
#import <dispatch/dispatch.h>
#include <atomic>
#include <mutex>
#include <string>
#include <chrono>
#endif

#ifdef __APPLE__

// 将 CGEventFlags 修饰键状态解析到 JS 字段
struct ModifierState {
    bool shift;
    bool ctrl;
    bool alt;
    bool meta;
};

static ModifierState extractModifiers(CGEventFlags flags) {
    return {
        .shift = (flags & kCGEventFlagMaskShift) != 0,
        .ctrl  = (flags & kCGEventFlagMaskControl) != 0,
        .alt   = (flags & kCGEventFlagMaskAlternate) != 0,
        .meta  = (flags & kCGEventFlagMaskCommand) != 0
    };
}

// CGKeyCode → 可读键名映射 (常用键)
static std::string keyCodeToName(CGKeyCode keyCode) {
    switch (keyCode) {
        case kVK_Return:       return "Enter";
        case kVK_Tab:          return "Tab";
        case kVK_Space:        return "Space";
        case kVK_Delete:       return "Backspace";
        case kVK_Escape:       return "Escape";
        case kVK_ForwardDelete:return "Delete";
        case kVK_UpArrow:      return "ArrowUp";
        case kVK_DownArrow:    return "ArrowDown";
        case kVK_LeftArrow:    return "ArrowLeft";
        case kVK_RightArrow:   return "ArrowRight";
        case kVK_Home:         return "Home";
        case kVK_End:          return "End";
        case kVK_PageUp:       return "PageUp";
        case kVK_PageDown:     return "PageDown";
        case kVK_F1:           return "F1";
        case kVK_F2:           return "F2";
        case kVK_F3:           return "F3";
        case kVK_F4:           return "F4";
        case kVK_F5:           return "F5";
        case kVK_F6:           return "F6";
        case kVK_F7:           return "F7";
        case kVK_F8:           return "F8";
        case kVK_F9:           return "F9";
        case kVK_F10:          return "F10";
        case kVK_F11:          return "F11";
        case kVK_F12:          return "F12";
        case kVK_Shift:        return "Shift";
        case kVK_RightShift:   return "Shift";
        case kVK_Control:      return "Control";
        case kVK_RightControl: return "Control";
        case kVK_Option:       return "Alt";
        case kVK_RightOption:  return "Alt";
        case kVK_Command:      return "Meta";
        case kVK_RightCommand: return "Meta";
        case kVK_CapsLock:     return "CapsLock";
        default:               return "";
    }
}

// 从 CGEvent 获取 Unicode 字符
static std::string getKeyCharacter(CGEventRef event) {
    UniChar chars[4] = {0};
    UniCharCount len = 0;
    CGEventKeyboardGetUnicodeString(event, 4, &len, chars);
    if (len > 0 && chars[0] >= 0x20 && chars[0] < 0x7F) {
        char buf[2] = { static_cast<char>(chars[0]), 0 };
        return std::string(buf);
    }
    return "";
}

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

    static CGEventRef EventCallback(CGEventTapProxy proxy, CGEventType type,
                                    CGEventRef event, void *userInfo);

    void HandleEvent(CGEventType type, CGEventRef event);

    Napi::ThreadSafeFunction tsfn_;
    std::atomic<bool> running_{false};
    bool monitorMouse_ = true;
    bool monitorKeyboard_ = true;

    CFMachPortRef eventTap_ = nullptr;
    CFRunLoopSourceRef runLoopSource_ = nullptr;
    CFRunLoopRef tapRunLoop_ = nullptr;
    dispatch_queue_t tapQueue_ = nullptr;

    // 鼠标移动节流
    int throttleMs_ = 16;
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

    tsfn_ = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "InputMonitorCallback",
        0, // unlimited queue
        1  // initial thread count
    );
}

InputMonitor::~InputMonitor() {
    StopMonitoring();
    if (tsfn_) {
        tsfn_.Release();
    }
}

CGEventRef InputMonitor::EventCallback(CGEventTapProxy /*proxy*/, CGEventType type,
                                       CGEventRef event, void *userInfo) {
    auto* self = static_cast<InputMonitor*>(userInfo);
    if (!self || !self->running_.load()) return event;

    // CGEventTap 被系统自动禁用时重新启用
    if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
        if (self->eventTap_) {
            CGEventTapEnable(self->eventTap_, true);
        }
        return event;
    }

    self->HandleEvent(type, event);
    return event; // 不拦截，原样传递
}

void InputMonitor::HandleEvent(CGEventType type, CGEventRef event) {
    CGPoint location = CGEventGetLocation(event);
    CGEventFlags flags = CGEventGetFlags(event);
    auto mods = extractModifiers(flags);
    double timestamp = static_cast<double>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()
        ).count()
    );

    // 鼠标移动事件节流
    if (type == kCGEventMouseMoved || type == kCGEventOtherMouseDragged ||
        type == kCGEventLeftMouseDragged || type == kCGEventRightMouseDragged) {
        if (!monitorMouse_) return;
        auto nowMs = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now().time_since_epoch()
        ).count();
        auto lastMs = lastMoveTs_.load();
        if (nowMs - lastMs < throttleMs_) return;
        lastMoveTs_.store(nowMs);
    }

    // 根据事件类型分发
    std::string eventType;
    std::string button;
    int clickCount = 0;
    double scrollDx = 0, scrollDy = 0;
    int keyCode = -1;
    std::string keyName;

    switch (type) {
        case kCGEventMouseMoved:
        case kCGEventLeftMouseDragged:
        case kCGEventRightMouseDragged:
        case kCGEventOtherMouseDragged:
            if (!monitorMouse_) return;
            eventType = "mouseMove";
            break;

        case kCGEventLeftMouseDown:
            if (!monitorMouse_) return;
            eventType = "mouseDown";
            button = "left";
            clickCount = static_cast<int>(CGEventGetIntegerValueField(event, kCGMouseEventClickState));
            break;

        case kCGEventLeftMouseUp:
            if (!monitorMouse_) return;
            eventType = "mouseUp";
            button = "left";
            break;

        case kCGEventRightMouseDown:
            if (!monitorMouse_) return;
            eventType = "mouseDown";
            button = "right";
            clickCount = static_cast<int>(CGEventGetIntegerValueField(event, kCGMouseEventClickState));
            break;

        case kCGEventRightMouseUp:
            if (!monitorMouse_) return;
            eventType = "mouseUp";
            button = "right";
            break;

        case kCGEventOtherMouseDown:
            if (!monitorMouse_) return;
            eventType = "mouseDown";
            button = "middle";
            clickCount = static_cast<int>(CGEventGetIntegerValueField(event, kCGMouseEventClickState));
            break;

        case kCGEventOtherMouseUp:
            if (!monitorMouse_) return;
            eventType = "mouseUp";
            button = "middle";
            break;

        case kCGEventScrollWheel:
            if (!monitorMouse_) return;
            eventType = "mouseScroll";
            scrollDy = CGEventGetDoubleValueField(event, kCGScrollWheelEventDeltaAxis1);
            scrollDx = CGEventGetDoubleValueField(event, kCGScrollWheelEventDeltaAxis2);
            break;

        case kCGEventKeyDown:
            if (!monitorKeyboard_) return;
            eventType = "keyDown";
            keyCode = static_cast<int>(CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode));
            keyName = keyCodeToName(static_cast<CGKeyCode>(keyCode));
            if (keyName.empty()) keyName = getKeyCharacter(event);
            break;

        case kCGEventKeyUp:
            if (!monitorKeyboard_) return;
            eventType = "keyUp";
            keyCode = static_cast<int>(CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode));
            keyName = keyCodeToName(static_cast<CGKeyCode>(keyCode));
            if (keyName.empty()) keyName = getKeyCharacter(event);
            break;

        case kCGEventFlagsChanged:
            if (!monitorKeyboard_) return;
            eventType = "keyDown";
            keyCode = static_cast<int>(CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode));
            keyName = keyCodeToName(static_cast<CGKeyCode>(keyCode));
            break;

        default:
            return;
    }

    // 捕获所有需要的值（避免在 lambda 中引用已释放的 CGEvent）
    double x = location.x;
    double y = location.y;

    tsfn_.NonBlockingCall(
        [eventType, timestamp, x, y, button, clickCount,
         scrollDx, scrollDy, keyCode, keyName, mods]
        (Napi::Env env, Napi::Function callback) {
            Napi::Object obj = Napi::Object::New(env);
            obj.Set("type", Napi::String::New(env, eventType));
            obj.Set("timestamp", Napi::Number::New(env, timestamp));
            obj.Set("x", Napi::Number::New(env, x));
            obj.Set("y", Napi::Number::New(env, y));

            if (!button.empty()) {
                obj.Set("button", Napi::String::New(env, button));
            }
            if (clickCount > 0) {
                obj.Set("clickCount", Napi::Number::New(env, clickCount));
            }
            if (eventType == "mouseScroll") {
                obj.Set("scrollDeltaX", Napi::Number::New(env, scrollDx));
                obj.Set("scrollDeltaY", Napi::Number::New(env, scrollDy));
            }
            if (keyCode >= 0) {
                obj.Set("keyCode", Napi::Number::New(env, keyCode));
            }
            if (!keyName.empty()) {
                obj.Set("key", Napi::String::New(env, keyName));
            }

            obj.Set("shift", Napi::Boolean::New(env, mods.shift));
            obj.Set("ctrl", Napi::Boolean::New(env, mods.ctrl));
            obj.Set("alt", Napi::Boolean::New(env, mods.alt));
            obj.Set("meta", Napi::Boolean::New(env, mods.meta));

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

    CGEventMask mask = 0;
    if (mouse) {
        mask |= CGEventMaskBit(kCGEventMouseMoved)
             |  CGEventMaskBit(kCGEventLeftMouseDown)
             |  CGEventMaskBit(kCGEventLeftMouseUp)
             |  CGEventMaskBit(kCGEventRightMouseDown)
             |  CGEventMaskBit(kCGEventRightMouseUp)
             |  CGEventMaskBit(kCGEventOtherMouseDown)
             |  CGEventMaskBit(kCGEventOtherMouseUp)
             |  CGEventMaskBit(kCGEventScrollWheel)
             |  CGEventMaskBit(kCGEventLeftMouseDragged)
             |  CGEventMaskBit(kCGEventRightMouseDragged)
             |  CGEventMaskBit(kCGEventOtherMouseDragged);
    }
    if (keyboard) {
        mask |= CGEventMaskBit(kCGEventKeyDown)
             |  CGEventMaskBit(kCGEventKeyUp)
             |  CGEventMaskBit(kCGEventFlagsChanged);
    }

    // 在专用 GCD 串行队列上运行 CGEventTap 的 RunLoop
    tapQueue_ = dispatch_queue_create("com.mulby.input-monitor", DISPATCH_QUEUE_SERIAL);

    dispatch_async(tapQueue_, ^{
        // Guard: stop() may have been called between dispatch_async and actual execution
        if (!running_.load()) return;

        eventTap_ = CGEventTapCreate(
            kCGSessionEventTap,
            kCGHeadInsertEventTap,
            kCGEventTapOptionListenOnly,
            mask,
            InputMonitor::EventCallback,
            this
        );

        if (!eventTap_) {
            running_.store(false);
            return;
        }

        runLoopSource_ = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap_, 0);
        tapRunLoop_ = CFRunLoopGetCurrent();
        CFRunLoopAddSource(tapRunLoop_, runLoopSource_, kCFRunLoopCommonModes);
        CGEventTapEnable(eventTap_, true);

        // Re-check: StopMonitoring may have run between the first check and here.
        // CFRunLoopStop before CFRunLoopRun has undefined behavior, so bail out.
        if (!running_.load()) {
            // Clean up and return without entering the run loop
            CGEventTapEnable(eventTap_, false);
            if (runLoopSource_) { CFRelease(runLoopSource_); runLoopSource_ = nullptr; }
            CFRelease(eventTap_); eventTap_ = nullptr;
            tapRunLoop_ = nullptr;
            return;
        }

        CFRunLoopRun();

        // RunLoop exited (StopMonitoring called CFRunLoopStop).
        // Clean up tap resources on this queue to avoid races with StopMonitoring.
        if (eventTap_) {
            CGEventTapEnable(eventTap_, false);
            if (runLoopSource_) {
                CFRelease(runLoopSource_);
                runLoopSource_ = nullptr;
            }
            CFRelease(eventTap_);
            eventTap_ = nullptr;
        }
        tapRunLoop_ = nullptr;
    });
}

void InputMonitor::StopMonitoring() {
    if (!running_.load()) return;
    running_.store(false);

    // Signal the RunLoop to exit; resource cleanup happens inside the dispatch block.
    if (tapRunLoop_) {
        CFRunLoopStop(tapRunLoop_);
    }

    // Synchronously drain the queue to ensure cleanup completes before returning.
    if (tapQueue_) {
        dispatch_sync(tapQueue_, ^{});
        tapQueue_ = nullptr;
    }
}

Napi::Value InputMonitor::Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    bool mouse = true;
    bool keyboard = true;
    int throttleMs = 16;

    if (info.Length() > 0 && info[0].IsObject()) {
        Napi::Object opts = info[0].As<Napi::Object>();
        if (opts.Has("mouse") && opts.Get("mouse").IsBoolean()) {
            mouse = opts.Get("mouse").As<Napi::Boolean>().Value();
        }
        if (opts.Has("keyboard") && opts.Get("keyboard").IsBoolean()) {
            keyboard = opts.Get("keyboard").As<Napi::Boolean>().Value();
        }
        if (opts.Has("throttleMs") && opts.Get("throttleMs").IsNumber()) {
            throttleMs = opts.Get("throttleMs").As<Napi::Number>().Int32Value();
            if (throttleMs < 0) throttleMs = 0;
        }
    }

    StartMonitoring(mouse, keyboard, throttleMs);
    return env.Undefined();
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

#endif // __APPLE__

// N-API 模块导出
Napi::Object Init(Napi::Env env, Napi::Object exports) {
#ifdef __APPLE__
    return InputMonitor::Init(env, exports);
#else
    return exports;
#endif
}

NODE_API_MODULE(input_monitor, Init)
