#!/bin/bash
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
# 已存在的同名目录若 SKILL.md 有更新则备份后重新复制。
# ============================================================================

set -euo pipefail

# ── 颜色定义 ─────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
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
      echo "将 mulby/skills/ 下的 skill 以符号链接同步到各 AI IDE 的 skills 目录。"
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
if [[ "$OS" == "windows" ]]; then
  # 优先使用 USERPROFILE，回退到 HOMEDRIVE+HOMEPATH
  if [[ -n "${USERPROFILE:-}" ]]; then
    WIN_HOME=$(cygpath -u "$USERPROFILE" 2>/dev/null || echo "$USERPROFILE")
  elif [[ -n "${HOMEDRIVE:-}" && -n "${HOMEPATH:-}" ]]; then
    WIN_HOME=$(cygpath -u "${HOMEDRIVE}${HOMEPATH}" 2>/dev/null || echo "${HOMEDRIVE}${HOMEPATH}")
  else
    WIN_HOME="$HOME"
  fi
  SKILL_HOME="$WIN_HOME"
else
  SKILL_HOME="$HOME"
fi

# ── 源目录（脚本相对定位到项目根目录） ──────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/../skills" && pwd)"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo -e "${YELLOW}⚠ 源目录不存在: $SOURCE_DIR${RESET}"
  exit 1
fi

# ── 目标目录列表（覆盖主流 AI 编码工具） ──────────────────────────────────────
# 格式: "标签|路径"
# 注意: Antigravity 实际读取的是 workspace 内的 .agent/skills/，
#       而非全局的 ~/.gemini/antigravity/skills/
TARGET_LIST=(
  "Antigravity (workspace)|$SCRIPT_DIR/../.agent/skills"
  "Agents (通用标准)|$SKILL_HOME/.agents/skills"
  "Gemini CLI|$SKILL_HOME/.gemini/skills"
  "Antigravity (global)|$SKILL_HOME/.gemini/antigravity/skills"
  "Codex CLI|$SKILL_HOME/.codex/skills"
  "Claude Code|$SKILL_HOME/.claude/skills"
  "Cursor|$SKILL_HOME/.cursor/skills"
  "Windsurf|$SKILL_HOME/.codeium/windsurf/skills"
)

# ── skill 同步函数（cp -r 复制，基于 SKILL.md 修改时间增量判断） ──────────────
# 返回值: 0=已复制/更新, 1=已是最新跳过
sync_skill() {
  local source="$1"   # 源 skill 目录（不含末尾斜杠）
  local target="$2"   # 目标路径

  local src_skill="$source/SKILL.md"
  local dst_skill="$target/SKILL.md"

  # 如果目标已存在且 SKILL.md 修改时间相同，跳过
  if [[ -d "$target" && -f "$dst_skill" && -f "$src_skill" ]]; then
    local src_mtime dst_mtime
    if [[ "$OS" == "macos" ]]; then
      src_mtime=$(stat -f "%m" "$src_skill" 2>/dev/null || echo 0)
      dst_mtime=$(stat -f "%m" "$dst_skill" 2>/dev/null || echo 0)
    else
      src_mtime=$(stat -c "%Y" "$src_skill" 2>/dev/null || echo 0)
      dst_mtime=$(stat -c "%Y" "$dst_skill" 2>/dev/null || echo 0)
    fi
    if [[ "$src_mtime" -le "$dst_mtime" ]]; then
      return 1  # 已是最新，跳过
    fi
  fi

  # 目标已存在则先备份
  if [[ -e "$target" || -L "$target" ]]; then
    local backup_path="${target}.bak.$(date +%Y%m%d%H%M%S)"
    echo -e "   ${YELLOW}⚠${RESET} 备份: ${DIM}$target → $backup_path${RESET}"
    mv "$target" "$backup_path"
  fi

  cp -r "$source" "$target"
  return 0
}

# ── 主逻辑 ─────────────────────────────────────────────────────────────────
echo -e "${CYAN}📦 Mulby Skills 复制同步工具${RESET}"
echo -e "${DIM}   源目录: $SOURCE_DIR${RESET}"
echo -e "${DIM}   系统: $OS${RESET}"
echo ""

linked_count=0
skipped_count=0

for entry in "${TARGET_LIST[@]}"; do
  label="${entry%%|*}"
  target_dir="${entry##*|}"

  # 检查目标 skills 目录的父目录是否存在（判断 IDE 是否已安装）
  parent_dir="$(dirname "$target_dir")"
  if [[ ! -d "$parent_dir" ]]; then
    if [[ "$FORCE" == true ]]; then
      mkdir -p "$target_dir"
    else
      echo -e "${DIM}   跳过 $label — 未检测到安装 ($parent_dir)${RESET}"
      ((skipped_count++)) || true
      continue
    fi
  fi

  # 确保 skills 目录存在
  mkdir -p "$target_dir"

  # 遍历每个 skill 子目录
  for skill_path in "$SOURCE_DIR"/*/; do
    [[ ! -d "$skill_path" ]] && continue
    skill_name=$(basename "$skill_path")
    [[ "$skill_name" == .* ]] && continue  # 跳过隐藏目录

    target_path="$target_dir/$skill_name"

    # 如果目标是符号链接，先清理（改为 cp 模式后不再使用链接）
    if [[ -L "$target_path" ]]; then
      echo -e "   ${YELLOW}⚠${RESET} 移除旧符号链接: ${DIM}$target_path${RESET}"
      rm "$target_path"
    fi

    if sync_skill "${skill_path%/}" "$target_path"; then
      echo -e "   ${GREEN}✅${RESET} $label/$skill_name ${DIM}(已复制)${RESET}"
      ((linked_count++)) || true
    else
      echo -e "   ${GREEN}✓${RESET} $label/$skill_name ${DIM}(已是最新)${RESET}"
    fi
  done
done

echo ""
if [[ $linked_count -gt 0 ]]; then
  echo -e "${GREEN}完成！已同步 $linked_count 个 skill。${RESET}"
else
  echo -e "${GREEN}完成！所有 skill 已是最新状态。${RESET}"
fi
if [[ $skipped_count -gt 0 ]]; then
  echo -e "${DIM}跳过了 $skipped_count 个未安装的 IDE（使用 --force 强制创建）${RESET}"
fi
