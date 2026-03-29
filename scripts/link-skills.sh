#!/bin/sh
# ============================================================================
# link-skills.sh
# 将 mulby/skills/ 下的 skills 以 cp -r 复制同步到各 AI 编码工具的 skills 目录
# 支持 macOS / Linux / Windows (Git Bash, MSYS2, Cygwin, WSL)
#
# 注意: 部分 AI 工具（如 Antigravity）不支持跟随符号链接读取 skill，
#       因此改用 cp -r 复制真实文件。每次修改 skill 后需重新运行本脚本同步。
#
# 用法:
#   bash scripts/link-skills.sh           # 同步到已安装的 IDE
#   bash scripts/link-skills.sh --force   # 同步到所有 IDE（含未安装的）
#   bash scripts/link-skills.sh --help    # 查看帮助
#
# 支持的 IDE:
#   - Antigravity (workspace)  .agent/skills/
#   - Agents (通用标准)        ~/.agents/skills/
#   - Gemini CLI               ~/.gemini/skills/
#   - Antigravity (global)     ~/.gemini/antigravity/skills/
#   - Codex CLI                ~/.codex/skills/
#   - Claude Code              ~/.claude/skills/
#   - Cursor                   ~/.cursor/skills/
#   - Windsurf                 ~/.codeium/windsurf/skills/
#
# 默认行为: 仅对已安装（父目录存在）的 IDE 同步，未安装的自动跳过。
# 使用 --force 可为所有 IDE 强制创建目录并同步。
# 已存在的同名目录若 SKILL.md 有更新则直接覆盖（不备份）。
# ============================================================================

set -eu

# ── 颜色定义 ─────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  CYAN='\033[0;36m'
  DIM='\033[2m'
  RESET='\033[0m'
else
  GREEN='' YELLOW='' CYAN='' DIM='' RESET=''
fi

# ── 参数解析 ─────────────────────────────────────────────────────────────────
FORCE=false
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    --help|-h)
      echo "用法: $0 [--force]"
      echo ""
      echo "将 mulby/skills/ 下的 skill 以 cp -r 复制同步到各 AI IDE 的 skills 目录。"
      echo ""
      echo "选项:"
      echo "  --force   为所有已知 IDE 创建目录和链接（即使 IDE 尚未安装）"
      echo "  --help    显示此帮助信息"
      exit 0
      ;;
  esac
done

# ── 检测操作系统与 HOME 目录 ──────────────────────────────────────────────────
OS="unknown"
case "$(uname -s)" in
  Darwin)       OS="macos" ;;
  Linux)        OS="linux" ;;
  MINGW*|MSYS*) OS="windows" ;;
  CYGWIN*)      OS="windows" ;;
  *)            OS="linux" ;; # 回退到 Linux 兼容模式
esac

# Windows 下 IDE 配置始终在 USERPROFILE 目录下
# 注意: MSYS2/Cygwin 的 $HOME 可能指向 /home/<user> 而非真实的 Windows 用户目录
if [ "$OS" = "windows" ]; then
  # 优先使用 USERPROFILE，回退到 HOMEDRIVE+HOMEPATH
  if [ -n "${USERPROFILE:-}" ]; then
    WIN_HOME=$(cygpath -u "$USERPROFILE" 2>/dev/null || echo "$USERPROFILE")
  elif [ -n "${HOMEDRIVE:-}" ] && [ -n "${HOMEPATH:-}" ]; then
    WIN_HOME=$(cygpath -u "${HOMEDRIVE}${HOMEPATH}" 2>/dev/null || echo "${HOMEDRIVE}${HOMEPATH}")
  else
    WIN_HOME="$HOME"
  fi
  SKILL_HOME="$WIN_HOME"
else
  SKILL_HOME="$HOME"
fi

# ── 源目录（脚本相对定位到项目根目录） ──────────────────────────────────────
# 注意: 避免 ${BASH_SOURCE[0]}，在 sh 兼容模式下会 bad substitution
# cygpath 用于 Windows Git Bash 下将 Windows 路径转为 POSIX 路径
_raw_script="$0"
if command -v cygpath >/dev/null 2>&1; then
  _raw_script="$(cygpath -u "$_raw_script")"
fi
SCRIPT_DIR="$(cd "$(dirname "$_raw_script")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/../skills" && pwd)"

if [ ! -d "$SOURCE_DIR" ]; then
  printf "%b\n" "${YELLOW}⚠ 源目录不存在: $SOURCE_DIR${RESET}"
  exit 1
fi

# ── TARGET_LIST (POSIX sh 兼容，用换行符分隔替代 bash 数组) ──────────────────
# 格式: "标签|路径"
# 注意: Antigravity 实际读取的是 workspace 内的 .agent/skills/，
#       而非全局的 ~/.gemini/antigravity/skills/
TARGET_LIST="Antigravity (workspace)|$SCRIPT_DIR/../.agent/skills
Agents (通用标准)|$SKILL_HOME/.agents/skills
Gemini CLI|$SKILL_HOME/.gemini/skills
Antigravity (global)|$SKILL_HOME/.gemini/antigravity/skills
Codex CLI|$SKILL_HOME/.codex/skills
Claude Code|$SKILL_HOME/.claude/skills
Cursor|$SKILL_HOME/.cursor/skills
Windsurf|$SKILL_HOME/.codeium/windsurf/skills"

# ── skill 同步函数（cp -r 复制，基于 SKILL.md 修改时间增量判断） ──────────────
# 返回值: 0=已复制/更新, 1=已是最新跳过
sync_skill() {
  source_skill="$1"   # 源 skill 目录（不含末尾斜杠）
  target_skill="$2"   # 目标路径

  src_skill_md="$source_skill/SKILL.md"
  dst_skill_md="$target_skill/SKILL.md"

  # 如果目标已存在且 SKILL.md 修改时间相同，跳过
  if [ -d "$target_skill" ] && [ -f "$dst_skill_md" ] && [ -f "$src_skill_md" ]; then
    if [ "$OS" = "macos" ]; then
      src_mtime=$(stat -f "%m" "$src_skill_md" 2>/dev/null || echo 0)
      dst_mtime=$(stat -f "%m" "$dst_skill_md" 2>/dev/null || echo 0)
    else
      src_mtime=$(stat -c "%Y" "$src_skill_md" 2>/dev/null || echo 0)
      dst_mtime=$(stat -c "%Y" "$dst_skill_md" 2>/dev/null || echo 0)
    fi
    if [ "$src_mtime" -le "$dst_mtime" ]; then
      return 1  # 已是最新，跳过
    fi
  fi

  # 目标已存在则直接删除（不再备份，因为备份目录会被 AI 工具误识别为 skill）
  if [ -e "$target_skill" ] || [ -L "$target_skill" ]; then
    rm -rf "$target_skill"
  fi

  cp -r "$source_skill" "$target_skill"
  return 0
}

# ── 主逻辑 ─────────────────────────────────────────────────────────────────
printf "%b\n" "${CYAN}📦 Mulby Skills 复制同步工具${RESET}"
printf "%b\n" "${DIM}   源目录: $SOURCE_DIR${RESET}"
printf "%b\n" "${DIM}   系统: $OS${RESET}"
echo ""

linked_count=0
skipped_count=0

# POSIX sh 兼容：用 IFS 换行符遍历字符串替代 bash 数组
IFS_BACKUP="$IFS"
IFS='
'
for entry in $TARGET_LIST; do
  IFS="$IFS_BACKUP"
  label="${entry%%|*}"
  target_dir="${entry##*|}"

  # 检查目标 skills 目录的父目录是否存在（判断 IDE 是否已安装）
  parent_dir="$(dirname "$target_dir")"
  if [ ! -d "$parent_dir" ]; then
    if [ "$FORCE" = "true" ]; then
      mkdir -p "$target_dir"
    else
      printf "%b\n" "${DIM}   跳过 $label — 未检测到安装 ($parent_dir)${RESET}"
      skipped_count=$((skipped_count + 1))
      IFS='
'
      continue
    fi
  fi

  # 确保 skills 目录存在
  mkdir -p "$target_dir"

  # 清理旧版备份目录（*.bak.*），避免被 AI 工具误识别为 skill
  for bak_dir in "$target_dir"/*.bak.*; do
    [ -e "$bak_dir" ] || continue
    rm -rf "$bak_dir"
    printf "   %b\n" "${YELLOW}🗑${RESET} 清理旧备份: ${DIM}$(basename "$bak_dir")${RESET}"
  done

  # 遍历每个 skill 子目录
  for skill_path in "$SOURCE_DIR"/*/; do
    [ ! -d "$skill_path" ] && continue
    skill_name=$(basename "$skill_path")
    case "$skill_name" in .*) continue ;; esac  # 跳过隐藏目录

    target_path="$target_dir/$skill_name"

    # 如果目标是符号链接，先清理（改为 cp 模式后不再使用链接）
    if [ -L "$target_path" ]; then
      printf "   %b\n" "${YELLOW}⚠${RESET} 移除旧符号链接: ${DIM}$target_path${RESET}"
      rm "$target_path"
    fi

    # 去掉末尾斜杠
    skill_path_clean="${skill_path%/}"

    if sync_skill "$skill_path_clean" "$target_path"; then
      printf "   %b\n" "${GREEN}✅${RESET} $label/$skill_name ${DIM}(已复制)${RESET}"
      linked_count=$((linked_count + 1))
    else
      printf "   %b\n" "${GREEN}✓${RESET}  $label/$skill_name ${DIM}(已是最新)${RESET}"
    fi
  done
  IFS='
'
done
IFS="$IFS_BACKUP"

echo ""
if [ "$linked_count" -gt 0 ]; then
  printf "%b\n" "${GREEN}完成！已同步 $linked_count 个 skill。${RESET}"
else
  printf "%b\n" "${GREEN}完成！所有 skill 已是最新状态。${RESET}"
fi
if [ "$skipped_count" -gt 0 ]; then
  printf "%b\n" "${DIM}跳过了 $skipped_count 个未安装的 IDE（使用 --force 强制创建）${RESET}"
fi
