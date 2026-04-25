cmake_minimum_required(VERSION 3.15)
project(text_selection LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(text_selection SHARED text_selection.cpp)

# Link Windows UI Automation and COM runtime
target_link_libraries(text_selection PRIVATE ole32 oleaut32 uuid)

# Export symbols without .def file
target_compile_definitions(text_selection PRIVATE TEXT_SELECTION_EXPORTS)

# UTF-8 source and execution character set
target_compile_options(text_selection PRIVATE /utf-8)
