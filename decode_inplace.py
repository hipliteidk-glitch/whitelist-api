import re, json, sys

def decode(s):
    return bytes(b ^ 95 for b in s.encode('latin-1')).decode('utf-8', errors='ignore')

def escape_lua(s):
    # escape backslashes, quotes, and newlines for Lua string literal
    return s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')

def decode_lua_string(s):
    # handle Lua string escapes (simple version)
    # we need to parse the actual escaped string from the source
    # but we already have the raw bytes, we just decode XOR, so we don't need to unescape
    # we just need to produce a valid Lua string literal with the decoded bytes
    # the decoded bytes are already plain text (no escapes), but we need to escape quotes and backslashes
    return escape_lua(s)

with open('ViolenceDistrict.lua', 'r') as f:
    content = f.read()

# find BID1 table
start = content.find('local BID1 = {')
if start == -1:
    print('BID1 not found')
    sys.exit(1)

# find the matching closing brace (we need to parse the table)
i = start + len('local BID1 = {')
brace = 1
j = i
while j < len(content) and brace > 0:
    ch = content[j]
    if ch == '{':
        brace += 1
    elif ch == '}':
        brace -= 1
    j += 1
end_table = j - 1  # position of the closing '}'
table_content = content[i:end_table]  # includes everything inside the braces

# Now we need to replace each string literal in table_content with decoded version
# We'll parse the strings from table_content and replace them
new_table_parts = []
pos = 0
while pos < len(table_content):
    ch = table_content[pos]
    if ch == '"' or ch == "'":
        quote = ch
        pos += 1
        start_str = pos
        while pos < len(table_content):
            if table_content[pos] == '\\':
                pos += 2
            elif table_content[pos] == quote:
                break
            else:
                pos += 1
        if pos < len(table_content) and table_content[pos] == quote:
            raw = table_content[start_str:pos]
            # decode raw (it's already escaped in the source? Actually raw is the content inside quotes, with escapes like \n, \", etc.)
            # We need to unescape it first to get the actual bytes, then decode XOR, then escape again for output.
            # Simple approach: we know the decoding is XOR 95 on each byte after unescaping.
            # We'll parse the raw string with Lua escapes.
            # We'll implement a simple parser.
            def parse_lua_string(s):
                res = bytearray()
                i = 0
                while i < len(s):
                    if s[i] == '\\':
                        i += 1
                        if i >= len(s): break
                        c = s[i]
                        if c == 'n': res.append(10)
                        elif c == 'r': res.append(13)
                        elif c == 't': res.append(9)
                        elif c == '\\': res.append(92)
                        elif c == '"': res.append(34)
                        elif c == "'": res.append(39)
                        elif c == 'z': res.append(0)  # not standard but maybe
                        elif c.isdigit():
                            num = 0
                            for _ in range(3):
                                if i < len(s) and s[i].isdigit():
                                    num = num*8 + int(s[i])
                                    i += 1
                                else: break
                            res.append(num)
                            continue
                        else:
                            # unknown escape, just take the character
                            res.append(ord(c))
                        i += 1
                    else:
                        res.append(ord(s[i]))
                        i += 1
                return bytes(res)
            decoded_bytes = parse_lua_string(raw)
            # XOR 95
            decoded = bytes(b ^ 95 for b in decoded_bytes)
            # now convert to string (should be utf-8)
            try:
                decoded_str = decoded.decode('utf-8')
            except:
                # fallback to latin-1
                decoded_str = decoded.decode('latin-1')
            # escape for Lua string literal
            escaped = escape_lua(decoded_str)
            new_part = quote + escaped + quote
            new_table_parts.append(new_part)
            pos += 1  # skip closing quote
        else:
            # unmatched quote, just keep
            new_table_parts.append(ch)
            pos += 1
    else:
        new_table_parts.append(ch)
        pos += 1

new_table_content = ''.join(new_table_parts)
new_content = content[:start] + 'local BID1 = {' + new_table_content + content[end_table:]

with open('ViolenceDistrict_decoded.lua', 'w') as f:
    f.write(new_content)

print('Done')
