#include <napi.h>

#ifdef _WIN32

class WindowWatcher : public Napi::ObjectWrap<WindowWatcher> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    WindowWatcher(const Napi::CallbackInfo& info);
    ~WindowWatcher();

private:
    static Napi::FunctionReference constructor;

    Napi::Value Start(const Napi::CallbackInfo& info);
    Napi::Value Stop(const Napi::CallbackInfo& info);
};

Napi::FunctionReference WindowWatcher::constructor;

WindowWatcher::WindowWatcher(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<WindowWatcher>(info) {
}

WindowWatcher::~WindowWatcher() {
}

Napi::Value WindowWatcher::Start(const Napi::CallbackInfo& info) {
    return info.Env().Undefined();
}

Napi::Value WindowWatcher::Stop(const Napi::CallbackInfo& info) {
    return info.Env().Undefined();
}

Napi::Object WindowWatcher::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "WindowWatcher", {
        InstanceMethod("start", &WindowWatcher::Start),
        InstanceMethod("stop", &WindowWatcher::Stop)
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("WindowWatcher", func);
    return exports;
}

#endif

Napi::Object Init(Napi::Env env, Napi::Object exports) {
#ifdef _WIN32
    return WindowWatcher::Init(env, exports);
#else
    return exports; // Used just in case
#endif
}

NODE_API_MODULE(window_watcher, Init)
