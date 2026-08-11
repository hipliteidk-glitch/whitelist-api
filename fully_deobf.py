import re, json, sys

def decode(s):
    return bytes(b ^ 95 for b in s.encode('latin-1')).decode('utf-8', errors='ignore')

# read original
with open('ViolenceDistrict.lua', 'r') as f:
    content = f.read()

# extract BID1 table
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

# parse strings
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
    mapping[idx] = decode(s)

def escape_lua(s):
    # escape backslashes and quotes, and newlines
    return s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')

# replace lOD[index] with string
def repl(match):
    idx = int(match.group(1))
    if idx in mapping:
        return '"' + escape_lua(mapping[idx]) + '"'
    return match.group(0)

# replace all occurrences of lOD[number]
pattern = r'lOD\s*\[\s*(\d+)\s*\]'
new_content = re.sub(pattern, repl, content)

# also handle lOD[var] where var is a variable - leave as lOD[var]
# we don't touch those

# remove the entire local lOD block
# find the line with 'local lOD' and then find matching end
lines = new_content.splitlines()
new_lines = []
skip = False
lOD_start = -1
lOD_end = -1
depth = 0
for i, line in enumerate(lines):
    if not skip:
        if line.strip().startswith('local lOD'):
            skip = True
            lOD_start = i
            depth = 1  # we are inside the do block? actually line has 'local lOD  do'
            # we need to find the matching end for the do block
            # but the block might have nested do/end, we count
            # we'll just skip until we hit a matching end
            # simpler: find the first 'end' that is at depth 0 after the block
            # we'll just remove from this line to the line that has the matching end
            # we can count do/end
            continue
    else:
        # count do and end
        # but we are already in skip mode, we need to find the end of the do block
        # we can count nested do/end
        # we'll just look for an 'end' that is at the same depth as the initial do
        # we can count the number of 'do' and 'end' tokens in the block
        # we'll use a simple count
        # we start depth=1 for the initial do
        # when we see 'do' increment, when we see 'end' decrement
        # when depth reaches 0, we stop
        # but we also need to handle strings and comments
        # We'll do a rough count
        for token in re.findall(r'\b(do|end)\b', line):
            if token == 'do':
                depth += 1
            elif token == 'end':
                depth -= 1
                if depth == 0:
                    # this is the matching end for the do block
                    skip = False
                    break
        if not skip:
            continue
# Now we need to rebuild the file without the skipped lines
# Actually we can just use a flag to skip until depth returns to 0

# Let's redo the removal properly
new_lines = []
in_block = False
depth = 0
for line in lines:
    stripped = line.strip()
    if not in_block:
        if stripped.startswith('local lOD'):
            in_block = True
            depth = 1  # the 'do' starts a block
            # we don't add this line
            continue
        else:
            new_lines.append(line)
    else:
        # inside the block, we count do/end
        # we need to handle strings and comments to avoid false counts
        # we'll just count all 'do' and 'end' tokens, but it's rough
        # we'll increment for 'do' and decrement for 'end'
        # but we should only count tokens that are not in strings/comments
        # For simplicity, we'll just scan the line manually or use regex with word boundaries
        # We'll use a simple approach: remove all occurrences of 'do' and 'end' but only if they are standalone words
        # We can use re.findall
        # For speed, we'll just do a rough count and hope it's correct
        for token in re.findall(r'\b(do|end)\b', line):
            if token == 'do':
                depth += 1
            elif token == 'end':
                depth -= 1
                if depth == 0:
                    # this is the end of the block, we skip this line too
                    in_block = False
                    break
        # if we are still in the block, skip this line
        if in_block:
            continue
        else:
            # after exiting, we add the line? Actually we already skipped the 'end' line, so we don't add it
            # but we might have broken out early, so we continue to next lines
            pass

# But this doesn't work because we break out of the loop prematurely.
# Let's just use a simpler method: find the start index and end index, then slice.
# We'll find the line number of 'local lOD' and then find the matching 'end' by counting.

start_line = -1
for i, line in enumerate(lines):
    if line.strip().startswith('local lOD'):
        start_line = i
        break
if start_line == -1:
    print('local lOD not found')
    sys.exit(1)

# Now find the matching end
depth = 0
end_line = -1
for i in range(start_line, len(lines)):
    line = lines[i]
    # count do/end ignoring strings/comments
    # We'll just use the same rough method
    for token in re.findall(r'\b(do|end)\b', line):
        if token == 'do':
            depth += 1
        elif token == 'end':
            depth -= 1
            if depth == 0:
                end_line = i
                break
    if end_line != -1:
        break

if end_line == -1:
    print('Could not find matching end')
    sys.exit(1)

# Remove the lines from start_line to end_line inclusive
new_lines = lines[:start_line] + lines[end_line+1:]
new_content = '\n'.join(new_lines)

# Also fix any remaining 'local lOD' references? The block is removed, but there might be references to lOD later.
# We have already replaced lOD[...] with strings, so those are fine.
# However, there might be assignments to lOD? The block is the only place that assigns to lOD.
# We can also remove the local declaration if any remains.

# Write the new file
with open('ViolenceDistrict_fully_deobf.lua', 'w') as f:
    f.write(new_content)

print('Done')
