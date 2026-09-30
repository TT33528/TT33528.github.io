# -*- coding: utf-8 -*-
"""
同步 static/ -> docs/assets/，并保证外链加载的 JS/CSS 是"裸"源码。

为什么需要这一步：
  static/ 下的 tt-post.js / tt-index.js 若带 <script>...</script> 包装标签，
  内联进 config.json 的 script / indexScript 字段是必需的（因为 Gmeek 的注入点
  在已闭合的 </script> 之后）；但改成 <script src="..."> 外链加载后，浏览器把
  整个文件当 JS 解析，字面量 <script> 会直接造成 SyntaxError，整段脚本静默失效。

  因此本脚本在复制时统一剥掉包装标签，static/ 永远保持"可直接外链"的裸源码。

用法：
  python tools/sync_assets.py
"""
import pathlib
import re
import shutil
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
SRC = REPO / "static"
DST = REPO / "docs" / "assets"

WRAPPER = re.compile(r"^\s*<(script|style)\b[^>]*>\s*$|^\s*</(script|style)>\s*$")


def strip_wrappers(text: str) -> str:
    lines = text.splitlines()
    while lines and WRAPPER.match(lines[0]):
        lines.pop(0)
    while lines and WRAPPER.match(lines[-1]):
        lines.pop()
    return "\n".join(lines) + ("\n" if lines else "")


def main() -> int:
    if not SRC.is_dir():
        print(f"[错误] 找不到 {SRC}")
        return 1
    DST.mkdir(parents=True, exist_ok=True)

    copied = 0
    for f in sorted(SRC.iterdir()):
        if not f.is_file():
            continue
        target = DST / f.name
        if f.suffix in {".js", ".css"}:
            body = strip_wrappers(f.read_text(encoding="utf-8"))
            # newline="\n"：保持 LF，避免 Windows 上被写成 CRLF 导致全文件 diff
            with open(target, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(body)
            print(f"  {f.name:<20} 剥离包装标签 -> {target}")
        else:
            shutil.copy2(f, target)
            print(f"  {f.name:<20} 复制        -> {target}")
        copied += 1

    if not copied:
        print("[警告] static/ 为空，未同步任何文件")
        return 1

    # 自检：发布目录里不允许再出现字面量包装标签
    bad = []
    for f in DST.glob("*.js"):
        if re.search(r"^\s*<script\b", f.read_text(encoding="utf-8"), re.M):
            bad.append(f.name)
    for f in DST.glob("*.css"):
        if re.search(r"^\s*</style>", f.read_text(encoding="utf-8"), re.M):
            bad.append(f.name)
    if bad:
        print(f"[错误] 以下文件仍含包装标签，外链加载会失效：{bad}")
        return 1

    print(f"[完成] 同步 {copied} 个文件到 {DST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
