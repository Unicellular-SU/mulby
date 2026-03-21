#!/bin/bash
# ============================================================================
# link-skills.sh
# 将 mulby/skills/ 下的 skills 以符号链接同步到各 AI 编码工具的 skills 目录
# 支持 macOS / Linux / Windows (Git Bash, MSYS2, Cygwin, WSL)
#
# 用法:
#   bash scripts/link-skills.sh           # 同步到已安装的 IDE
#   bash scripts/link-skills.sh --force   # 同步到所有 IDE（含未安装的）
#   bash scripts/link-skills.sh --help    # 查看帮助
#
# 支持的 IDE:
#   - Agents (通用标准)    ~/.agents/skills/
#   - Gemini CLI          ~/.gemini/skills/
#   - Antigravity         ~/.gemini/antigravity/skills/
#   - Codex CLI           ~/.codex/skills/
#   - Claude Code         ~/.claude/skills/
#   - Cursor              ~/.cursor/skills/
#   - Windsurf            ~/.codeium/windsurf/skills/
#
# 默认行为: 仅对已安装（父目录存在）的 IDE 创建链接，未安装的自动跳过。
# 使用 --force 可为所有 IDE 强制创建目录和链接。
# 已存在的同名真实目录会被备份为 .bak.时间戳 后再替换。
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

# Windows 下 HOME 可能需要从 USERPROFILE 推导
if [[ "$OS" == "windows" && -z "${HOME:-}" ]]; then
  HOME="${USERPROFILE:-/c/Users/$(whoami)}"
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
TARGET_LIST=(
  "Agents (通用标准)|$HOME/.agents/skills"
  "Gemini CLI|$HOME/.gemini/skills"
  "Antigravity|$HOME/.gemini/antigravity/skills"
  "Codex CLI|$HOME/.codex/skills"
  "Claude Code|$HOME/.claude/skills"
  "Cursor|$HOME/.cursor/skills"
  "Windsurf|$HOME/.codeium/windsurf/skills"
)

# ── 符号链接创建函数（跨平台） ────────────────────────────────────────────────
create_symlink() {
  local source="$1"
  local target="$2"

  if [[ "$OS" == "windows" ]]; then
    # Windows: 使用 mklink /D 创建目录符号链接
    # 需要将 Unix 风格路径转换为 Windows 路径
    local win_source win_target
    win_source=$(cygpath -w "$source" 2>/dev/null || echo "$source")
    win_target=$(cygpath -w "$target" 2>/dev/null || echo "$target")
    cmd //c "mklink /D \"$win_target\" \"$win_source\"" > /dev/null 2>&1
  else
    ln -s "$source" "$target"
  fi
}

# ── 主逻辑 ─────────────────────────────────────────────────────────────────
echo -e "${CYAN}🔗 Mulby Skills 符号链接同步工具${RESET}"
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

    # 如果已经是正确的符号链接，跳过
    if [[ -L "$target_path" ]]; then
      existing_target=$(readlink "$target_path" 2>/dev/null || echo "")
      # 规范化路径比较（去掉末尾斜杠）
      norm_skill="${skill_path%/}"
      norm_existing="${existing_target%/}"
      if [[ "$norm_existing" == "$norm_skill" ]]; then
        echo -e "   ${GREEN}✓${RESET} $label/$skill_name ${DIM}(已链接)${RESET}"
        continue
      fi
    fi

    # 如果存在真实目录或错误链接，先备份
    if [[ -e "$target_path" || -L "$target_path" ]]; then
      backup_path="${target_path}.bak.$(date +%Y%m%d%H%M%S)"
      echo -e "   ${YELLOW}⚠${RESET} 备份: ${DIM}$target_path → $backup_path${RESET}"
      mv "$target_path" "$backup_path"
    fi

    # 创建符号链接
    create_symlink "$skill_path" "$target_path"
    echo -e "   ${GREEN}✅${RESET} $label/$skill_name → ${DIM}$skill_path${RESET}"
    ((linked_count++)) || true
  done
done

echo ""
if [[ $linked_count -gt 0 ]]; then
  echo -e "${GREEN}完成！新建 $linked_count 个符号链接。${RESET}"
else
  echo -e "${GREEN}完成！所有链接已是最新状态。${RESET}"
fi
if [[ $skipped_count -gt 0 ]]; then
  echo -e "${DIM}跳过了 $skipped_count 个未安装的 IDE（使用 --force 强制创建）${RESET}"
fi
