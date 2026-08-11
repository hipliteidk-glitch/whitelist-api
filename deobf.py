import re, sys

def parse_lua_string(s):
    res = bytearray()
    i = 0
    while i < len(s):
        if s[i] == '\\':
            i += 1
            if i >= len(s): break
            c = s[i]
            if c in '\\"\'':
                res.append(ord(c)); i += 1
            elif c == 'n': res.append(10); i += 1
            elif c == 'r': res.append(13); i += 1
            elif c == 't': res.append(9); i += 1
            elif c.isdigit():
                num = 0
                for _ in range(3):
                    if i < len(s) and s[i].isdigit():
                        num = num * 8 + int(s[i]); i += 1
                    else: break
                res.append(num)
            else:
                res.append(ord(c)); i += 1
        else:
            res.append(ord(s[i])); i += 1
    return bytes(res)

def decode_lod(bs):
    return bytes(b ^ 95 for b in bs)

with open('ViolenceDistrict.lua', 'r', encoding='utf-8') as f:
    content = f.read()

start = content.find('local BID1 = {')
if start == -1:
    print('BID1 not found'); sys.exit(1)
i = start + len('local BID1 = {')
brace = 1
table_chars = []
while i < len(content) and brace > 0:
    ch = content[i]
    if ch == '{': brace += 1
    elif ch == '}': brace -= 1
    if brace == 0: break
    table_chars.append(ch)
    i += 1
table_str = ''.join(table_chars)

strings = []
j = 0
while j < len(table_str):
    if table_str[j] in ('"', "'"):
        q = table_str[j]
        j += 1
        start_s = j
        while j < len(table_str):
            if table_str[j] == '\\':
                j += 2
            elif table_str[j] == q:
                break
            else:
                j += 1
        if j < len(table_str) and table_str[j] == q:
            strings.append(table_str[start_s:j])
            j += 1
        else:
            break
    else:
        j += 1

mapping = {i+1: decode_lod(parse_lua_string(s)).decode('utf-8', errors='ignore') for i, s in enumerate(strings)}

import re
pat = re.compile(r'lOD\s*\[\s*(\d+)\s*\]')
def repl(m):
    idx = int(m.group(1))
    return '"' + mapping.get(idx, '') + '"' if idx in mapping else m.group(0)

new = pat.sub(repl, content)
with open('ViolenceDistrict_deobf.lua', 'w', encoding='utf-8') as f:
    f.write(new)
print('OK')
