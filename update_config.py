import json

with open('config.json', 'r') as f:
    cfg = json.load(f)

tools = cfg['servers']['phone']['tools']

# Check if already exists to avoid duplicates
if not any(t.get('name') == 'update_zeroscript' for t in tools):
    tools.append({
        'name': 'update_zeroscript',
        'description': 'Update the ZeroScript-Free repository (git pull) and show the latest commit.',
        'cwd': '{ZS_WORKSPACE}',
        'run': ['bash', 'ZeroScript-Free/update.sh']
    })
    with open('config.json', 'w') as f:
        json.dump(cfg, f, indent=2)
    print('Added update_zeroscript tool.')
else:
    print('update_zeroscript already exists.')
