import requests
import json
import time
import os
import subprocess
from datetime import datetime, timedelta

SHOWS_FILE = 'shows.txt'
LOG_FILE = 'sent.log'
NTFY_TOPIC = 'zeroscript_alerts'

def send_ntfy(message, title='Anime Alert', priority='default'):
    """Send a notification to ntfy.sh"""
    url = f'https://ntfy.sh/{NTFY_TOPIC}'
    headers = {'Title': title, 'Priority': priority}
    try:
        response = requests.post(url, data=message, headers=headers, timeout=10)
        return response.status_code == 200
    except Exception as e:
        print(f'Failed to send ntfy: {e}')
        return False

def test_ntfy():
    """Send a test notification to ntfy"""
    print('Sending test notification to ntfy...')
    ok = send_ntfy('Test notification from Anime Alert!', title='🔔 Test', priority='high')
    if ok:
        print('✅ Test notification sent!')
    else:
        print('❌ Failed to send test notification.')

def load_shows():
    if not os.path.exists(SHOWS_FILE):
        with open(SHOWS_FILE, 'w') as f:
            f.write("# List anime titles, one per line\n")
            f.write("One Piece\n")
            f.write("Demon Slayer\n")
        return []
    with open(SHOWS_FILE, 'r') as f:
        return [line.strip() for line in f if line.strip() and not line.startswith('#')]

def search_anime(title):
    url = f"https://api.jikan.moe/v4/anime?q={title}&limit=1"
    resp = requests.get(url)
    if resp.status_code != 200:
        return None
    data = resp.json()
    if data['data']:
        return data['data'][0]
    return None

def get_episode_info(anime_id):
    url = f"https://api.jikan.moe/v4/anime/{anime_id}/episodes"
    resp = requests.get(url)
    if resp.status_code != 200:
        return None
    data = resp.json()
    if data['data']:
        latest = data['data'][-1]
        return latest['episode_id'], latest['title'], latest['aired']
    return None

def send_notification(title, message):
    # Try ntfy first
    if send_ntfy(message, title=title):
        return
    # Fallback to termux-notification
    try:
        subprocess.run(['termux-notification', '--title', title, '--content', message], check=True)
    except:
        print("Failed to send notification. Ensure termux-api is installed.")

def main():
    shows = load_shows()
    if not shows:
        print("No shows listed.")
        return
    for show in shows:
        anime = search_anime(show)
        if not anime:
            continue
        anime_id = anime['mal_id']
        info = get_episode_info(anime_id)
        if not info:
            continue
        ep_id, ep_title, aired = info
        if os.path.exists(LOG_FILE):
            with open(LOG_FILE, 'r') as f:
                sent = f.read().splitlines()
        else:
            sent = []
        key = f"{anime_id}:{ep_id}"
        if key in sent:
            continue
        message = f"{show} - Episode {ep_id}: {ep_title}"
        send_notification("Anime Alert", message)
        with open(LOG_FILE, 'a') as f:
            f.write(key + '\n')

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == 'test':
        test_ntfy()
    else:
        while True:
            main()
            time.sleep(21600)
