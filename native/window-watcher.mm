#include <napi.h>

#ifdef __APPLE__
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#endif

class WindowWatcher : public Napi::ObjectWrap<WindowWatcher> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    WindowWatcher(const Napi::CallbackInfo& info);
    ~WindowWatcher();

private:
    static Napi::FunctionReference constructor;

    Napi::Value Start(const Napi::CallbackInfo& info);
    Napi::Value Stop(const Napi::CallbackInfo& info);

    void StartWatching();
    void StopWatching();

    Napi::ThreadSafeFunction tsfn;
    bool isWatching = false;

#ifdef __APPLE__
    id workspaceObserver = nil;
    AXObserverRef axObserver = NULL;
    NSString *currentAppName = nil;
    NSString *currentBundleId = nil;
    pid_t currentPid = 0;

    void RegisterAXObserver(pid_t pid);
    void UnregisterAXObserver();
public:
    void NotifyJS();
#endif
};

Napi::FunctionReference WindowWatcher::constructor;

WindowWatcher::WindowWatcher(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<WindowWatcher>(info) {

    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function expected").ThrowAsJavaScriptException();
        return;
    }

    Napi::Function callback = info[0].As<Napi::Function>();

    tsfn = Napi::ThreadSafeFunction::New(
        env,
        callback,
        "WindowWatcher",
        0,
        1
    );
}

WindowWatcher::~WindowWatcher() {
    StopWatching();
    if (tsfn) {
        tsfn.Release();
    }
}

#ifdef __APPLE__
static void AXWindowChangedCallback(AXObserverRef observer, AXUIElementRef element, CFStringRef notification, void *refcon) {
    WindowWatcher* watcher = static_cast<WindowWatcher*>(refcon);
    if (watcher) {
        watcher->NotifyJS();
    }
}

void WindowWatcher::NotifyJS() {
    if (!currentAppName || !currentBundleId) return;
    
    NSString* appName = [currentAppName copy];
    NSString* bundleId = [currentBundleId copy];
    pid_t pid = currentPid;

    auto calljs = [appName, bundleId, pid](Napi::Env env, Napi::Function jsCallback) {
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("app", Napi::String::New(env, [appName UTF8String]));
        obj.Set("bundleId", Napi::String::New(env, [bundleId UTF8String]));
        obj.Set("pid", Napi::Number::New(env, pid));
        jsCallback.Call({obj});
        
        [appName release];
        [bundleId release];
    };

    if (tsfn && isWatching) {
        tsfn.BlockingCall(calljs);
    } else {
        [appName release];
        [bundleId release];
    }
}

void WindowWatcher::RegisterAXObserver(pid_t pid) {
    UnregisterAXObserver();
    
    currentPid = pid;

    AXError err = AXObserverCreate(pid, AXWindowChangedCallback, &axObserver);
    if (err == kAXErrorSuccess && axObserver) {
        AXUIElementRef appElem = AXUIElementCreateApplication(pid);
        if (appElem) {
            AXObserverAddNotification(axObserver, appElem, kAXFocusedWindowChangedNotification, this);
            AXObserverAddNotification(axObserver, appElem, kAXTitleChangedNotification, this);
            CFRelease(appElem);

            CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(axObserver), kCFRunLoopDefaultMode);
        }
    }
}

void WindowWatcher::UnregisterAXObserver() {
    if (axObserver) {
        CFRunLoopSourceRef rlSource = AXObserverGetRunLoopSource(axObserver);
        if (rlSource) {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), rlSource, kCFRunLoopDefaultMode);
        }
        CFRelease(axObserver);
        axObserver = NULL;
    }
}
#endif

void WindowWatcher::StartWatching() {
    if (isWatching) return;
    isWatching = true;

#ifdef __APPLE__
    WindowWatcher* self = this;
    
    NSRunningApplication *frontApp = [[NSWorkspace sharedWorkspace] frontmostApplication];
    if (frontApp) {
        self->currentAppName = [frontApp.localizedName ?: @"" copy];
        self->currentBundleId = [frontApp.bundleIdentifier ?: @"" copy];
        self->RegisterAXObserver(frontApp.processIdentifier);
        self->NotifyJS();
    }

    workspaceObserver = [[[NSWorkspace sharedWorkspace] notificationCenter]
        addObserverForName:NSWorkspaceDidActivateApplicationNotification
        object:nil
        queue:[NSOperationQueue mainQueue]
        usingBlock:^(NSNotification * _Nonnull notification) {
            NSRunningApplication *app = notification.userInfo[NSWorkspaceApplicationKey];
            if (!app) return;

            if (self->currentAppName) [self->currentAppName release];
            if (self->currentBundleId) [self->currentBundleId release];

            self->currentAppName = [app.localizedName ?: @"" copy];
            self->currentBundleId = [app.bundleIdentifier ?: @"" copy];
            
            self->RegisterAXObserver(app.processIdentifier);
            self->NotifyJS();
        }];
#endif
}

void WindowWatcher::StopWatching() {
    if (!isWatching) return;
    isWatching = false;

#ifdef __APPLE__
    if (workspaceObserver) {
        [[[NSWorkspace sharedWorkspace] notificationCenter] removeObserver:workspaceObserver];
        workspaceObserver = nil;
    }
    
    UnregisterAXObserver();
    
    if (currentAppName) {
        [currentAppName release];
        currentAppName = nil;
    }
    if (currentBundleId) {
        [currentBundleId release];
        currentBundleId = nil;
    }
#endif
}

Napi::Value WindowWatcher::Start(const Napi::CallbackInfo& info) {
    StartWatching();
    return info.Env().Undefined();
}

Napi::Value WindowWatcher::Stop(const Napi::CallbackInfo& info) {
    StopWatching();
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

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return WindowWatcher::Init(env, exports);
}

NODE_API_MODULE(window_watcher, Init)
