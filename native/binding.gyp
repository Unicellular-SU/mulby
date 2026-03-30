{
  "targets": [
    {
      "target_name": "clipboard_watcher",
      "sources": ["clipboard-watcher.mm"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_CXX_LIBRARY": "libc++",
              "MACOSX_DEPLOYMENT_TARGET": "10.13",
              "OTHER_CFLAGS": ["-ObjC++"]
            },
            "link_settings": {
              "libraries": ["-framework AppKit", "-framework Foundation"]
            }
          }
        ],
        [
          "OS=='win'",
          {
            "sources": ["clipboard-watcher.cc"],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1
              }
            }
          }
        ],
        [
          "OS=='linux'",
          {
            "sources": ["clipboard-watcher.cc"],
            "libraries": ["-lX11"]
          }
        ]
      ]
    },
    {
      "target_name": "window_watcher",
      "sources": ["window-watcher.mm"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_CXX_LIBRARY": "libc++",
              "MACOSX_DEPLOYMENT_TARGET": "10.13",
              "OTHER_CFLAGS": ["-ObjC++"]
            },
            "link_settings": {
              "libraries": ["-framework AppKit", "-framework Foundation"]
            }
          }
        ],
        [
          "OS=='win'",
          {
            "sources": ["window-watcher.cpp"],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1
              }
            }
          }
        ],
        [
          "OS=='linux'",
          {
            "sources": ["window-watcher.cpp"]
          }
        ]
      ]
    },
    {
      "target_name": "screen_capture",
      "sources": ["screen-capture.mm"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_CXX_LIBRARY": "libc++",
              "MACOSX_DEPLOYMENT_TARGET": "10.15",
              "OTHER_CFLAGS": ["-ObjC++"]
            },
            "link_settings": {
              "libraries": ["-framework CoreGraphics", "-framework AppKit", "-framework Foundation"]
            }
          }
        ],
        [
          "OS=='win'",
          {
            "sources": ["screen-capture.cpp"],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1
              }
            },
            "libraries": ["-lgdi32"]
          }
        ],
        [
          "OS=='linux'",
          {
            "sources": ["screen-capture.cpp"],
            "libraries": ["-lX11"]
          }
        ]
      ]
    }
  ]
}
