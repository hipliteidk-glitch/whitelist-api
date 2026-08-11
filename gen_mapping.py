import re, json, sys

def decode(s):
    return bytes(b ^ 95 for b in s.encode('latin-1')).decode('utf-8', errors='ignore')

with open('ViolenceDistrict.lua', 'r') as f:
    content = f.read()

start = content.find('local BID1 = {')
if start == -1:
    print('BID1 not found')
    sys.exit(1)
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

with open('mapping.lua', 'w') as f:
    f.write('return {\n')
    for k, v in sorted(mapping.items()):
        v_escaped = v.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')
        f.write('  [{}] = "{}",\n'.format(k, v_escaped))
    f.write('}\n')

print('Mapping generated')
