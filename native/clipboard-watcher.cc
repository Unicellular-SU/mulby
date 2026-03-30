/**
 * clipboard-watcher.cc — Windows/Linux 编译入口
 *
 * 实际实现在 clipboard-watcher.mm 中（通过 #ifdef 条件编译）。
 * macOS 直接编译 .mm（Objective-C++），
 * Windows/Linux 通过此 .cc 文件 #include .mm 来编译对应平台的代码。
 */
#include "clipboard-watcher.mm"
