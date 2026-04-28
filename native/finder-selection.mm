#include <napi.h>

#ifdef __APPLE__
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

static NSString *PathFromAXValue(CFTypeRef value) {
    if (!value) return nil;

    id object = (id)value;
    if ([object isKindOfClass:[NSURL class]]) {
        return [(NSURL *)object path];
    }
    if ([object isKindOfClass:[NSString class]]) {
        NSString *string = (NSString *)object;
        if ([string hasPrefix:@"file://"]) {
            NSURL *url = [NSURL URLWithString:string];
            return [url path];
        }
        if ([string hasPrefix:@"/"]) {
            return string;
        }
    }
    return nil;
}

static NSString *CopyPathFromElement(AXUIElementRef element) {
    if (!element) return nil;

    static CFStringRef attrs[] = {
        CFSTR("AXURL"),
        CFSTR("AXFilename"),
        CFSTR("AXDocument")
    };

    for (CFStringRef attr : attrs) {
        CFTypeRef value = NULL;
        AXError error = AXUIElementCopyAttributeValue(element, attr, &value);
        if (error != kAXErrorSuccess || !value) continue;

        NSString *path = PathFromAXValue(value);
        if (path) {
            NSString *copy = [path copy];
            CFRelease(value);
            return [copy autorelease];
        }
        CFRelease(value);
    }

    return nil;
}

static void AddPath(NSMutableArray<NSString *> *paths, NSMutableSet<NSString *> *seen, NSString *path) {
    if (!path || [path length] == 0 || [seen containsObject:path]) return;
    [seen addObject:path];
    [paths addObject:path];
}

static void CollectPathsFromSelectedElement(AXUIElementRef element, NSMutableArray<NSString *> *paths, NSMutableSet<NSString *> *seen, int depth);

static void CollectPathsFromAXArray(CFArrayRef array, NSMutableArray<NSString *> *paths, NSMutableSet<NSString *> *seen) {
    if (!array) return;
    CFIndex count = CFArrayGetCount(array);
    for (CFIndex i = 0; i < count; i++) {
        AXUIElementRef child = (AXUIElementRef)CFArrayGetValueAtIndex(array, i);
        CollectPathsFromSelectedElement(child, paths, seen, 0);
    }
}

static void CollectPathsFromSelectedElement(AXUIElementRef element, NSMutableArray<NSString *> *paths, NSMutableSet<NSString *> *seen, int depth) {
    if (!element || depth > 4) return;

    AddPath(paths, seen, CopyPathFromElement(element));

    CFTypeRef children = NULL;
    AXError error = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, &children);
    if (error == kAXErrorSuccess && children && CFGetTypeID(children) == CFArrayGetTypeID()) {
        CFArrayRef childArray = (CFArrayRef)children;
        CFIndex count = MIN(CFArrayGetCount(childArray), 80);
        for (CFIndex i = 0; i < count; i++) {
            AXUIElementRef child = (AXUIElementRef)CFArrayGetValueAtIndex(childArray, i);
            CollectPathsFromSelectedElement(child, paths, seen, depth + 1);
        }
    }
    if (children) CFRelease(children);
}

static bool CollectSelectedPathsFromElement(AXUIElementRef element, NSMutableArray<NSString *> *paths, NSMutableSet<NSString *> *seen, int depth) {
    if (!element || depth > 5) return false;

    bool foundSelectionContainer = false;

    static CFStringRef selectedAttrs[] = {
        CFSTR("AXSelectedChildren"),
        CFSTR("AXSelectedRows")
    };

    for (CFStringRef attr : selectedAttrs) {
        CFTypeRef value = NULL;
        AXError error = AXUIElementCopyAttributeValue(element, attr, &value);
        if (error == kAXErrorSuccess && value && CFGetTypeID(value) == CFArrayGetTypeID()) {
            CFArrayRef array = (CFArrayRef)value;
            if (CFArrayGetCount(array) > 0) {
                foundSelectionContainer = true;
                CollectPathsFromAXArray(array, paths, seen);
            }
        }
        if (value) CFRelease(value);
    }

    if (foundSelectionContainer) return true;

    CFTypeRef children = NULL;
    AXError error = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, &children);
    if (error == kAXErrorSuccess && children && CFGetTypeID(children) == CFArrayGetTypeID()) {
        CFArrayRef childArray = (CFArrayRef)children;
        CFIndex count = MIN(CFArrayGetCount(childArray), 80);
        for (CFIndex i = 0; i < count; i++) {
            AXUIElementRef child = (AXUIElementRef)CFArrayGetValueAtIndex(childArray, i);
            if (CollectSelectedPathsFromElement(child, paths, seen, depth + 1)) {
                foundSelectionContainer = true;
            }
        }
    }
    if (children) CFRelease(children);

    return foundSelectionContainer;
}

static pid_t FinderPid() {
    NSArray<NSRunningApplication *> *apps = [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.apple.finder"];
    NSRunningApplication *finder = [apps firstObject];
    return finder ? [finder processIdentifier] : 0;
}

static Napi::Value GetSelectedPaths(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    @autoreleasepool {
        NSMutableArray<NSString *> *paths = [NSMutableArray array];
        NSMutableSet<NSString *> *seen = [NSMutableSet set];

        pid_t pid = FinderPid();
        if (pid <= 0) {
            Napi::Object response = Napi::Object::New(env);
            response.Set("paths", Napi::Array::New(env));
            response.Set("errorMessage", Napi::String::New(env, "Finder is not running"));
            return response;
        }

        AXUIElementRef appElement = AXUIElementCreateApplication(pid);
        if (!appElement) {
            Napi::Object response = Napi::Object::New(env);
            response.Set("paths", Napi::Array::New(env));
            response.Set("errorMessage", Napi::String::New(env, "Failed to create Finder AX element"));
            return response;
        }

        AXUIElementSetMessagingTimeout(appElement, 0.08);

        CFTypeRef focused = NULL;
        if (AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute, &focused) == kAXErrorSuccess && focused) {
            CollectSelectedPathsFromElement((AXUIElementRef)focused, paths, seen, 0);
            CFRelease(focused);
        }

        CFTypeRef focusedWindow = NULL;
        if (AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute, &focusedWindow) == kAXErrorSuccess && focusedWindow) {
            CollectSelectedPathsFromElement((AXUIElementRef)focusedWindow, paths, seen, 0);
            CFRelease(focusedWindow);
        }

        if ([paths count] == 0) {
            CollectSelectedPathsFromElement(appElement, paths, seen, 0);
        }

        if ([paths count] == 0) {
            CFTypeRef focusedFallback = NULL;
            if (AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute, &focusedFallback) == kAXErrorSuccess && focusedFallback) {
                CollectPathsFromSelectedElement((AXUIElementRef)focusedFallback, paths, seen, 0);
                CFRelease(focusedFallback);
            }
        }

        CFRelease(appElement);

        Napi::Array jsPaths = Napi::Array::New(env);
        for (NSUInteger i = 0; i < [paths count]; i++) {
            jsPaths.Set((uint32_t)i, Napi::String::New(env, [paths[i] UTF8String]));
        }

        Napi::Object response = Napi::Object::New(env);
        response.Set("paths", jsPaths);
        return response;
    }
}
#else
static Napi::Value GetSelectedPaths(const Napi::CallbackInfo& info) {
    Napi::Object response = Napi::Object::New(info.Env());
    response.Set("paths", Napi::Array::New(info.Env()));
    return response;
}
#endif

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("getSelectedPaths", Napi::Function::New(env, GetSelectedPaths));
    return exports;
}

NODE_API_MODULE(finder_selection, Init)
