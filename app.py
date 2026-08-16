from flask import Flask, request, jsonify
import requests
import json

app = Flask(__name__)

def get_user_id(username):
    url = "https://users.roblox.com/v1/usernames/users"
    payload = {"usernames": [username], "excludeBannedUsers": False}
    resp = requests.post(url, json=payload)
    if resp.status_code != 200:
        raise Exception(f"Username lookup failed: {resp.text}")
    data = resp.json()
    if not data.get("data"):
        raise Exception("Username not found")
    return data["data"][0]["id"]

def get_user_profile(user_id):
    url = f"https://users.roblox.com/v1/users/{user_id}"
    resp = requests.get(url)
    if resp.status_code != 200:
        raise Exception(f"Profile fetch failed: {resp.text}")
    return resp.json()

@app.route('/lookup', methods=['GET', 'POST'])
def lookup():
    try:
        if request.method == 'GET':
            username = request.args.get('username')
        else:
            data = request.get_json()
            username = data.get('username') if data else None
        if not username:
            return jsonify({"error": "Missing username parameter"}), 400
        user_id = get_user_id(username)
        profile = get_user_profile(user_id)
        result = {
            "id": user_id,
            "name": profile.get("name"),
            "displayName": profile.get("displayName"),
            "description": profile.get("description"),
            "created": profile.get("created"),
            "isBanned": profile.get("isBanned"),
            "hasVerifiedBadge": profile.get("hasVerifiedBadge")
        }
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000)
