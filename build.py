"""Build both versions from src/core.html plus an adapter. No dependencies: python3 build.py"""
import pathlib
root = pathlib.Path(__file__).parent
core = (root / 'src/core.html').read_text(encoding='utf-8')
builds = {
    'index.html': ('src/adapter-oss.js', '衣櫃顧問'),                       # open-source, bring your own key
    'claude-builtin/index.html': ('src/adapter-claude.js', '衣櫃顧問（Claude 版）'),  # Claude artifact version
}
for out, (adapter, title) in builds.items():
    code = (root / adapter).read_text(encoding='utf-8')
    assert '</script' not in code.lower()
    html = core.replace('/*@@ADAPTER@@*/', code).replace('/*@@PRIVATE_EXAMPLE@@*/', '').replace('@@TITLE@@', title)
    assert '@@' not in html
    (root / out).write_text(html, encoding='utf-8')
    print('built', out)
