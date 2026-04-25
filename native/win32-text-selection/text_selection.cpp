/**
 * Windows UI Automation - 获取当前焦点元素的选中文本
 *
 * 通过 COM 调用 IUIAutomation 客户端接口链：
 * CoCreateInstance(CLSID_CUIAutomation)
 *   → GetFocusedElement()
 *     → GetCurrentPatternAs(UIA_TextPatternId) → IUIAutomationTextPattern
 *       → GetSelection() → IUIAutomationTextRangeArray
 *         → GetElement(0) → IUIAutomationTextRange → GetText(-1)
 *
 * 导出函数：
 *   int GetSelectedTextW(wchar_t* buffer, int bufferSize)
 *     成功返回字符数（不含 \0），失败返回 0 或负数错误码
 *
 * 耗时：典型 5-15ms
 */

#include <windows.h>
#include <oleauto.h>
#include <wchar.h>

// 手动前向声明和 IID/CLSID，绕过 uiautomation.h 的头文件冲突
// 参考 Windows SDK UIAutomationClient.h 中的接口定义

#include <initguid.h>

// CLSID / IID 定义
DEFINE_GUID(CLSID_CUIAutomation,  0xff48dba4, 0x60ef, 0x4201, 0xaa, 0x87, 0x54, 0x10, 0x3e, 0xef, 0x59, 0x4e);
DEFINE_GUID(IID_IUIAutomation,    0x30cbe57d, 0xd9d0, 0x452a, 0xab, 0x13, 0x7a, 0xc5, 0xac, 0x48, 0x25, 0xee);
DEFINE_GUID(IID_IUIAutomationTextPattern, 0x32eba289, 0x3583, 0x42c9, 0x9c, 0x59, 0x3b, 0x6d, 0x9a, 0x1e, 0x9b, 0x6a);
DEFINE_GUID(IID_IUIAutomationTextPattern2, 0x506a921a, 0xfcc9, 0x409f, 0xb2, 0x3b, 0x37, 0xeb, 0x74, 0x10, 0x68, 0x72);

// UIA Pattern IDs
#define UIA_TextPatternId   10014
#define UIA_TextPattern2Id  10024

#ifdef TEXT_SELECTION_EXPORTS
#define DLL_API __declspec(dllexport)
#else
#define DLL_API __declspec(dllimport)
#endif

// ===== 手动定义 UIA 接口的 vtable（纯 C++ 抽象类） =====
// 只定义我们需要的方法，按 vtable 顺序排列

// IUIAutomationTextRange
struct IUIAutomationTextRange : public IUnknown {
    // vtable 继承 IUnknown (3个) + 自己的方法按顺序
    virtual HRESULT STDMETHODCALLTYPE Clone(IUIAutomationTextRange**) = 0;            // 3
    virtual HRESULT STDMETHODCALLTYPE Compare(IUIAutomationTextRange*, BOOL*) = 0;    // 4
    virtual HRESULT STDMETHODCALLTYPE CompareEndpoints(int, IUIAutomationTextRange*, int, int*) = 0; // 5
    virtual HRESULT STDMETHODCALLTYPE ExpandToEnclosingUnit(int) = 0;                 // 6
    virtual HRESULT STDMETHODCALLTYPE FindAttribute(int, VARIANT, BOOL, IUIAutomationTextRange**) = 0; // 7
    virtual HRESULT STDMETHODCALLTYPE FindText(BSTR, BOOL, BOOL, IUIAutomationTextRange**) = 0; // 8
    virtual HRESULT STDMETHODCALLTYPE GetAttributeValue(int, VARIANT*) = 0;           // 9
    virtual HRESULT STDMETHODCALLTYPE GetBoundingRectangles(SAFEARRAY**) = 0;         // 10
    virtual HRESULT STDMETHODCALLTYPE GetEnclosingElement(IUnknown**) = 0;            // 11
    virtual HRESULT STDMETHODCALLTYPE GetText(int maxLength, BSTR* text) = 0;         // 12
    // ... 后面的不需要
};

// IUIAutomationTextRangeArray
struct IUIAutomationTextRangeArray : public IUnknown {
    virtual HRESULT STDMETHODCALLTYPE get_Length(int* length) = 0;                    // 3
    virtual HRESULT STDMETHODCALLTYPE GetElement(int index, IUIAutomationTextRange** element) = 0; // 4
};

// IUIAutomationTextPattern
struct IUIAutomationTextPattern : public IUnknown {
    virtual HRESULT STDMETHODCALLTYPE RangeFromPoint(POINT, IUIAutomationTextRange**) = 0;  // 3
    virtual HRESULT STDMETHODCALLTYPE RangeFromChild(IUnknown*, IUIAutomationTextRange**) = 0; // 4
    virtual HRESULT STDMETHODCALLTYPE GetSelection(IUIAutomationTextRangeArray** ranges) = 0;  // 5
    virtual HRESULT STDMETHODCALLTYPE GetVisibleRanges(IUIAutomationTextRangeArray**) = 0;     // 6
    virtual HRESULT STDMETHODCALLTYPE get_DocumentRange(IUIAutomationTextRange**) = 0;          // 7
    virtual HRESULT STDMETHODCALLTYPE get_SupportedTextSelection(int*) = 0;                     // 8
};

// IUIAutomationElement (只声明我们需要的方法)
// vtable 布局较长，我们只需要 GetCurrentPattern / GetCurrentPatternAs
struct IUIAutomationElement : public IUnknown {
    // IUnknown: 0-2 (QueryInterface, AddRef, Release)
    // 3 SetFocus
    virtual HRESULT STDMETHODCALLTYPE SetFocus() = 0;
    // 4 GetRuntimeId
    virtual HRESULT STDMETHODCALLTYPE GetRuntimeId(SAFEARRAY**) = 0;
    // 5 FindFirst
    virtual HRESULT STDMETHODCALLTYPE FindFirst(int, IUnknown*, IUIAutomationElement**) = 0;
    // 6 FindAll
    virtual HRESULT STDMETHODCALLTYPE FindAll(int, IUnknown*, IUnknown**) = 0;
    // 7 FindFirstBuildCache
    virtual HRESULT STDMETHODCALLTYPE FindFirstBuildCache(int, IUnknown*, IUnknown*, IUIAutomationElement**) = 0;
    // 8 FindAllBuildCache
    virtual HRESULT STDMETHODCALLTYPE FindAllBuildCache(int, IUnknown*, IUnknown*, IUnknown**) = 0;
    // 9 BuildUpdatedCache
    virtual HRESULT STDMETHODCALLTYPE BuildUpdatedCache(IUnknown*, IUIAutomationElement**) = 0;
    // 10 GetCurrentPropertyValue
    virtual HRESULT STDMETHODCALLTYPE GetCurrentPropertyValue(int, VARIANT*) = 0;
    // 11 GetCurrentPropertyValueEx
    virtual HRESULT STDMETHODCALLTYPE GetCurrentPropertyValueEx(int, BOOL, VARIANT*) = 0;
    // 12 GetCachedPropertyValue
    virtual HRESULT STDMETHODCALLTYPE GetCachedPropertyValue(int, VARIANT*) = 0;
    // 13 GetCachedPropertyValueEx
    virtual HRESULT STDMETHODCALLTYPE GetCachedPropertyValueEx(int, BOOL, VARIANT*) = 0;
    // 14 GetCurrentPatternAs
    virtual HRESULT STDMETHODCALLTYPE GetCurrentPatternAs(int patternId, REFIID riid, void** patternObject) = 0;
    // 15 GetCachedPatternAs
    virtual HRESULT STDMETHODCALLTYPE GetCachedPatternAs(int, REFIID, void**) = 0;
    // 16 GetCurrentPattern
    virtual HRESULT STDMETHODCALLTYPE GetCurrentPattern(int, IUnknown**) = 0;
    // ... 后面还有很多 property getter，我们不需要
};

// IUIAutomation (只声明我们需要的方法)
struct IUIAutomation : public IUnknown {
    // 3 CompareElements
    virtual HRESULT STDMETHODCALLTYPE CompareElements(IUIAutomationElement*, IUIAutomationElement*, BOOL*) = 0;
    // 4 CompareRuntimeIds
    virtual HRESULT STDMETHODCALLTYPE CompareRuntimeIds(SAFEARRAY*, SAFEARRAY*, BOOL*) = 0;
    // 5 GetRootElement
    virtual HRESULT STDMETHODCALLTYPE GetRootElement(IUIAutomationElement**) = 0;
    // 6 ElementFromHandle
    virtual HRESULT STDMETHODCALLTYPE ElementFromHandle(HWND, IUIAutomationElement**) = 0;
    // 7 ElementFromPoint
    virtual HRESULT STDMETHODCALLTYPE ElementFromPoint(POINT, IUIAutomationElement**) = 0;
    // 8 GetFocusedElement
    virtual HRESULT STDMETHODCALLTYPE GetFocusedElement(IUIAutomationElement** element) = 0;
    // ... 后面不需要
};

// ===== 实现 =====

static int TryGetSelection(IUIAutomationTextPattern* textPat, wchar_t* buffer, int bufferSize) {
    IUIAutomationTextRangeArray* ranges = nullptr;
    HRESULT hr = textPat->GetSelection(&ranges);
    if (FAILED(hr) || !ranges) return 0;

    int rangeCount = 0;
    ranges->get_Length(&rangeCount);
    if (rangeCount <= 0) {
        ranges->Release();
        return 0;
    }

    IUIAutomationTextRange* range = nullptr;
    hr = ranges->GetElement(0, &range);
    ranges->Release();
    if (FAILED(hr) || !range) return 0;

    BSTR bstr = nullptr;
    hr = range->GetText(-1, &bstr);
    range->Release();
    if (FAILED(hr) || !bstr) return 0;

    int len = (int)SysStringLen(bstr);
    if (len <= 0) {
        SysFreeString(bstr);
        return 0;
    }

    int copyLen = (len < bufferSize - 1) ? len : (bufferSize - 1);
    wmemcpy(buffer, bstr, copyLen);
    buffer[copyLen] = L'\0';
    SysFreeString(bstr);

    return copyLen;
}

extern "C" {

/**
 * 获取当前焦点元素的选中文本（Unicode 宽字符）
 *
 * @param buffer     输出缓冲区（wchar_t*）
 * @param bufferSize 缓冲区大小（wchar_t 个数，包含 \0）
 * @return           成功：写入的字符数（不含 \0）
 *                   0：无选中文本 / TextPattern 不可用
 *                   负数：错误码
 *                     -1: COM 初始化失败 / 无效参数
 *                     -2: IUIAutomation 创建失败
 *                     -3: GetFocusedElement 失败
 *                     -10: TextPattern 获取失败
 *                     -11: TextPattern GetSelection 返回 0 个区域
 *                     -12: TextPattern GetText 返回空
 */
DLL_API int GetSelectedTextW(wchar_t* buffer, int bufferSize) {
    if (!buffer || bufferSize <= 0) return -1;
    buffer[0] = L'\0';

    // 初始化 COM（MTA 模式 — Electron 主线程通常已初始化为 MTA）
    HRESULT hrInit = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    // S_FALSE 表示当前线程已初始化 COM，无需再初始化
    // RPC_E_CHANGED_MODE 表示已初始化为不同模式（STA），仍可继续使用
    if (FAILED(hrInit) && hrInit != RPC_E_CHANGED_MODE && hrInit != S_FALSE) return -1;

    int returnValue = 0;
    IUIAutomation* uia = nullptr;
    IUIAutomationElement* focused = nullptr;

    // 创建 IUIAutomation 实例
    HRESULT hr = CoCreateInstance(
        CLSID_CUIAutomation, nullptr,
        CLSCTX_INPROC_SERVER,
        IID_IUIAutomation,
        (void**)&uia
    );
    if (FAILED(hr) || !uia) {
        returnValue = -2;
        goto cleanup;
    }

    // 获取当前焦点元素
    hr = uia->GetFocusedElement(&focused);
    if (FAILED(hr) || !focused) {
        returnValue = -3;
        goto cleanup;
    }

    // 策略 1：TextPattern（标准文本控件）
    {
        IUIAutomationTextPattern* textPat = nullptr;
        hr = focused->GetCurrentPatternAs(UIA_TextPatternId, IID_IUIAutomationTextPattern, (void**)&textPat);
        if (SUCCEEDED(hr) && textPat) {
            returnValue = TryGetSelection(textPat, buffer, bufferSize);
            textPat->Release();
            if (returnValue > 0) goto cleanup;
        }
    }

    // 策略 2：TextPattern2（某些现代应用）
    {
        // 对 TextPattern2 仍然用 IID_IUIAutomationTextPattern 来 QI，
        // 因为 GetSelection/GetText 继承自 TextPattern 基类
        IUIAutomationTextPattern* textPat = nullptr;
        hr = focused->GetCurrentPatternAs(UIA_TextPattern2Id, IID_IUIAutomationTextPattern, (void**)&textPat);
        if (SUCCEEDED(hr) && textPat) {
            returnValue = TryGetSelection(textPat, buffer, bufferSize);
            textPat->Release();
        }
    }

cleanup:
    if (focused) focused->Release();
    if (uia) uia->Release();
    // 仅当我们成功初始化了 COM 时才 Uninitialize
    if (hrInit == S_OK) CoUninitialize();
    return returnValue;
}

} // extern "C"
