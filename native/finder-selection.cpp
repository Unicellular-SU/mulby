#include <napi.h>

static Napi::Value GetSelectedPaths(const Napi::CallbackInfo& info) {
    Napi::Object response = Napi::Object::New(info.Env());
    response.Set("paths", Napi::Array::New(info.Env()));
    return response;
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("getSelectedPaths", Napi::Function::New(env, GetSelectedPaths));
    return exports;
}

NODE_API_MODULE(finder_selection, Init)
