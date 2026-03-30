/**
 * screen-capture.mm — macOS 原生截图 & 取色模块
 *
 * API:
 *   captureScreen(displayIndex?: number) → { buffer: Buffer, width, height }
 *   captureRegion(x, y, w, h) → { buffer: Buffer, width, height }
 *   getPixelColor(x, y) → { r, g, b }
 *   pickColor(callback) → void  (NSColorSampler 异步取色)
 *
 * 返回 raw BGRA bitmap，由 JS 层 nativeImage.createFromBitmap() 转 PNG。
 */

#include <napi.h>

#ifdef __APPLE__
#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#endif

// ============================================================
// macOS 实现
// ============================================================
#ifdef __APPLE__

/**
 * 从 CGImage 提取 BGRA bitmap 数据
 * 返回 { buffer, width, height } 对象给 JS 层
 */
static Napi::Object CGImageToNapiResult(Napi::Env env, CGImageRef image) {
    if (!image) {
        Napi::Error::New(env, "截图失败: CGImage 为空").ThrowAsJavaScriptException();
        return Napi::Object::New(env);
    }

    size_t width = CGImageGetWidth(image);
    size_t height = CGImageGetHeight(image);
    size_t bytesPerRow = width * 4;
    size_t totalBytes = bytesPerRow * height;

    // 创建 BGRA context 以匹配 Electron nativeImage bitmap 格式
    CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();

    // 分配临时缓冲区用于渲染
    std::vector<uint8_t> rawData(totalBytes);

    CGContextRef ctx = CGBitmapContextCreate(
        rawData.data(),
        width,
        height,
        8,
        bytesPerRow,
        colorSpace,
        kCGImageAlphaPremultipliedFirst | kCGBitmapByteOrder32Little  // BGRA 格式
    );

    CGColorSpaceRelease(colorSpace);

    if (!ctx) {
        Napi::Error::New(env, "截图失败: 无法创建 bitmap context").ThrowAsJavaScriptException();
        return Napi::Object::New(env);
    }

    // 绘制图像到 BGRA context
    CGContextDrawImage(ctx, CGRectMake(0, 0, width, height), image);
    CGContextRelease(ctx);

    // 创建 Node Buffer
    auto buffer = Napi::Buffer<uint8_t>::Copy(env, rawData.data(), totalBytes);

    Napi::Object result = Napi::Object::New(env);
    result.Set("buffer", buffer);
    result.Set("width", Napi::Number::New(env, static_cast<double>(width)));
    result.Set("height", Napi::Number::New(env, static_cast<double>(height)));

    return result;
}

/**
 * 全屏截图
 * captureScreen(displayIndex?: number) → { buffer, width, height }
 *
 * displayIndex 为可选参数，默认 0（主屏幕）。
 * 使用 CGWindowListCreateImage 截取整个屏幕内容（不包含鼠标光标），
 * 不需要隐藏任何窗口，零延迟。
 */
static Napi::Value CaptureScreen(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    uint32_t displayIndex = 0;
    if (info.Length() > 0 && info[0].IsNumber()) {
        displayIndex = info[0].As<Napi::Number>().Uint32Value();
    }

    // 获取所有在线显示器
    uint32_t displayCount = 0;
    CGGetOnlineDisplayList(0, nullptr, &displayCount);

    if (displayCount == 0) {
        Napi::Error::New(env, "截图失败: 没有可用的显示器").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::vector<CGDirectDisplayID> displays(displayCount);
    CGGetOnlineDisplayList(displayCount, displays.data(), &displayCount);

    if (displayIndex >= displayCount) {
        displayIndex = 0;  // 回退到主显示器
    }

    CGDirectDisplayID targetDisplay = displays[displayIndex];
    CGRect displayBounds = CGDisplayBounds(targetDisplay);

    // 使用 CGWindowListCreateImage 截取屏幕
    // kCGWindowListOptionOnScreenOnly: 只截取可见窗口
    // kCGNullWindowID: 不指定特定窗口
    CGImageRef image = CGWindowListCreateImage(
        displayBounds,
        kCGWindowListOptionOnScreenOnly,
        kCGNullWindowID,
        kCGWindowImageDefault
    );

    if (!image) {
        Napi::Error::New(env, "截图失败: CGWindowListCreateImage 返回空").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Object result = CGImageToNapiResult(env, image);
    CGImageRelease(image);

    return result;
}

/**
 * 区域截图
 * captureRegion(x, y, width, height) → { buffer, width, height }
 *
 * 直接截取指定矩形区域，无需先全屏再裁剪，性能最优。
 * 坐标为屏幕逻辑坐标（自动处理 HiDPI 缩放）。
 */
static Napi::Value CaptureRegion(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 4) {
        Napi::TypeError::New(env, "需要 4 个参数: x, y, width, height").ThrowAsJavaScriptException();
        return env.Null();
    }

    double x = info[0].As<Napi::Number>().DoubleValue();
    double y = info[1].As<Napi::Number>().DoubleValue();
    double w = info[2].As<Napi::Number>().DoubleValue();
    double h = info[3].As<Napi::Number>().DoubleValue();

    CGRect captureRect = CGRectMake(x, y, w, h);

    CGImageRef image = CGWindowListCreateImage(
        captureRect,
        kCGWindowListOptionOnScreenOnly,
        kCGNullWindowID,
        kCGWindowImageDefault
    );

    if (!image) {
        Napi::Error::New(env, "区域截图失败: CGWindowListCreateImage 返回空").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Object result = CGImageToNapiResult(env, image);
    CGImageRelease(image);

    return result;
}

/**
 * 获取指定坐标的像素颜色
 * getPixelColor(x, y) → { r, g, b }
 *
 * 通过截取 1x1 区域实现，性能极高（< 1ms）。
 */
static Napi::Value GetPixelColor(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "需要 2 个参数: x, y").ThrowAsJavaScriptException();
        return env.Null();
    }

    double x = info[0].As<Napi::Number>().DoubleValue();
    double y = info[1].As<Napi::Number>().DoubleValue();

    // 截取 1x1 区域
    CGRect captureRect = CGRectMake(x, y, 1, 1);
    CGImageRef image = CGWindowListCreateImage(
        captureRect,
        kCGWindowListOptionOnScreenOnly,
        kCGNullWindowID,
        kCGWindowImageDefault
    );

    if (!image) {
        Napi::Error::New(env, "取色失败").ThrowAsJavaScriptException();
        return env.Null();
    }

    // 从 CGImage 提取单个像素的 RGBA 值
    size_t width = CGImageGetWidth(image);
    size_t height = CGImageGetHeight(image);
    uint8_t pixel[4] = {0}; // BGRA

    CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
    CGContextRef ctx = CGBitmapContextCreate(
        pixel,
        1, 1,
        8, 4,
        colorSpace,
        kCGImageAlphaPremultipliedFirst | kCGBitmapByteOrder32Little
    );
    CGColorSpaceRelease(colorSpace);

    if (ctx) {
        // 将整个 image 绘制到 1x1 的 context 上取中心像素
        CGContextDrawImage(ctx, CGRectMake(0, 0, width, height), image);
        CGContextRelease(ctx);
    }

    CGImageRelease(image);

    // BGRA → RGB
    Napi::Object result = Napi::Object::New(env);
    result.Set("r", Napi::Number::New(env, pixel[2]));
    result.Set("g", Napi::Number::New(env, pixel[1]));
    result.Set("b", Napi::Number::New(env, pixel[0]));

    return result;
}

/**
 * NSColorSampler 原生取色器 (macOS 10.15+)
 * pickColor(callback) → void
 *
 * 调用系统原生取色面板（带放大镜），用户点击选色后回调。
 * callback(color | null): color = { r, g, b } | null (取消)
 */
static Napi::Value PickColor(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "需要一个回调函数参数").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // 创建 ThreadSafeFunction 用于跨线程回调
    Napi::ThreadSafeFunction tsfn = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "ColorPickerCallback",
        0,
        1
    );

    // 检查 NSColorSampler 是否可用 (macOS 10.15+)
    if (@available(macOS 10.15, *)) {
        // 在主线程执行 NSColorSampler（UI 操作必须在主线程）
        dispatch_async(dispatch_get_main_queue(), ^{
            NSColorSampler *sampler = [[NSColorSampler alloc] init];
            [sampler showSamplerWithSelectionHandler:^(NSColor * _Nullable selectedColor) {
                if (selectedColor) {
                    // 转换到 sRGB 色彩空间
                    NSColor *rgbColor = [selectedColor colorUsingColorSpace:[NSColorSpace sRGBColorSpace]];
                    if (rgbColor) {
                        CGFloat r, g, b, a;
                        [rgbColor getRed:&r green:&g blue:&b alpha:&a];

                        int ri = (int)(r * 255.0 + 0.5);
                        int gi = (int)(g * 255.0 + 0.5);
                        int bi = (int)(b * 255.0 + 0.5);

                        tsfn.BlockingCall([ri, gi, bi](Napi::Env env, Napi::Function callback) {
                            Napi::Object color = Napi::Object::New(env);
                            color.Set("r", Napi::Number::New(env, ri));
                            color.Set("g", Napi::Number::New(env, gi));
                            color.Set("b", Napi::Number::New(env, bi));
                            callback.Call({color});
                        });
                    } else {
                        // 色彩空间转换失败
                        tsfn.BlockingCall([](Napi::Env env, Napi::Function callback) {
                            callback.Call({env.Null()});
                        });
                    }
                } else {
                    // 用户取消了取色
                    tsfn.BlockingCall([](Napi::Env env, Napi::Function callback) {
                        callback.Call({env.Null()});
                    });
                }

                tsfn.Release();
            }];
        });
    } else {
        // macOS < 10.15，不支持 NSColorSampler
        tsfn.BlockingCall([](Napi::Env env, Napi::Function callback) {
            callback.Call({env.Null()});
        });
        tsfn.Release();
    }

    return env.Undefined();
}

/**
 * 获取所有显示器信息
 * getDisplays() → Array<{ id, x, y, width, height, scaleFactor }>
 */
static Napi::Value GetDisplays(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    uint32_t displayCount = 0;
    CGGetOnlineDisplayList(0, nullptr, &displayCount);

    std::vector<CGDirectDisplayID> displays(displayCount);
    CGGetOnlineDisplayList(displayCount, displays.data(), &displayCount);

    Napi::Array result = Napi::Array::New(env, displayCount);

    for (uint32_t i = 0; i < displayCount; i++) {
        CGDirectDisplayID did = displays[i];
        CGRect bounds = CGDisplayBounds(did);

        Napi::Object display = Napi::Object::New(env);
        display.Set("id", Napi::Number::New(env, static_cast<double>(did)));
        display.Set("x", Napi::Number::New(env, bounds.origin.x));
        display.Set("y", Napi::Number::New(env, bounds.origin.y));
        display.Set("width", Napi::Number::New(env, bounds.size.width));
        display.Set("height", Napi::Number::New(env, bounds.size.height));

        // 获取 HiDPI 缩放比
        CGFloat scaleFactor = 1.0;
        for (NSScreen *screen in [NSScreen screens]) {
            NSNumber *screenNumber = [screen.deviceDescription objectForKey:@"NSScreenNumber"];
            if (screenNumber && [screenNumber unsignedIntValue] == did) {
                scaleFactor = screen.backingScaleFactor;
                break;
            }
        }
        display.Set("scaleFactor", Napi::Number::New(env, scaleFactor));

        result.Set(i, display);
    }

    return result;
}

#endif // __APPLE__

// ============================================================
// N-API 模块导出
// ============================================================

Napi::Object Init(Napi::Env env, Napi::Object exports) {
#ifdef __APPLE__
    exports.Set("captureScreen", Napi::Function::New(env, CaptureScreen));
    exports.Set("captureRegion", Napi::Function::New(env, CaptureRegion));
    exports.Set("getPixelColor", Napi::Function::New(env, GetPixelColor));
    exports.Set("pickColor", Napi::Function::New(env, PickColor));
    exports.Set("getDisplays", Napi::Function::New(env, GetDisplays));
#endif
    return exports;
}

NODE_API_MODULE(screen_capture, Init)
