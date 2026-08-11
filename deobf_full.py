import re, json

def decode(s):
    return bytes(b ^ 95 for b in s.encode('latin-1')).decode('utf-8', errors='ignore')

with open('ViolenceDistrict.lua', 'r') as f:
    content = f.read()

start = content.find('local BID1 = {')
if start == -1:
    raise ValueError('BID1 not found')
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

mapping = {}
for idx, s in enumerate(strings, start=1):
    decoded = decode(s)
    mapping[idx] = decoded

def escape_lua_string(s):
    return json.dumps(s)

def repl(match):
    idx = int(match.group(1))
    if idx in mapping:
        return escape_lua_string(mapping[idx])
    return match.group(0)

new_content = re.sub(r'lOD\s*\[\s*(\d+)\s*\]', repl, content)

start_block = new_content.find('local lOD ')
if start_block != -1:
    start_do = new_content.find('do', start_block)
    if start_do != -1:
        end_match = re.search(r'\nend\s*\n', new_content[start_do:])
        if end_match:
            end_pos = start_do + end_match.start() + len('end')
            new_content = new_content[:start_block] + new_content[end_pos:]

with open('ViolenceDistrict_clean.lua', 'w') as f:
    f.write(new_content)

print('Done')
