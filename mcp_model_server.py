from flask import Flask, request, jsonify
import argparse
import math
import sys
import os

app = Flask(__name__)

def write_obj(filename, vertices, faces):
    with open(filename, 'w') as f:
        for v in vertices:
            f.write(f"v {v[0]:.6f} {v[1]:.6f} {v[2]:.6f}\n")
        for face in faces:
            if len(face) == 3:
                f.write(f"f {face[0]+1} {face[1]+1} {face[2]+1}\n")
            else:
                f.write(f"f {face[0]+1} {face[1]+1} {face[2]+1}\n")
                f.write(f"f {face[0]+1} {face[2]+1} {face[3]+1}\n")

def cube(size):
    s = size / 2.0
    v = [
        (-s,-s,-s), ( s,-s,-s), ( s, s,-s), (-s, s,-s),
        (-s,-s, s), ( s,-s, s), ( s, s, s), (-s, s, s)
    ]
    f = [
        (0,1,2), (0,2,3),
        (4,5,6), (4,6,7),
        (0,1,5), (0,5,4),
        (2,3,7), (2,7,6),
        (0,3,7), (0,7,4),
        (1,2,6), (1,6,5)
    ]
    return v, f

def sphere(radius, segments=16):
    verts = []
    faces = []
    for i in range(segments+1):
        theta = i * math.pi / segments
        for j in range(segments+1):
            phi = j * 2 * math.pi / segments
            x = radius * math.sin(theta) * math.cos(phi)
            y = radius * math.cos(theta)
            z = radius * math.sin(theta) * math.sin(phi)
            verts.append((x,y,z))
    for i in range(segments):
        for j in range(segments):
            a = i * (segments+1) + j
            b = a + 1
            c = (i+1) * (segments+1) + j
            d = c + 1
            faces.append((a,b,d))
            faces.append((a,d,c))
    return verts, faces

def house_mesh(width, depth, height, roof_height):
    w = width / 2.0
    d = depth / 2.0
    h = height
    rh = roof_height
    v = [
        (-w, 0, -d), ( w, 0, -d), ( w, 0,  d), (-w, 0,  d),
        (-w, h, -d), ( w, h, -d), ( w, h,  d), (-w, h,  d),
        ( 0, h+rh, -d), ( 0, h+rh,  d)
    ]
    faces = [
        (0,1,2), (0,2,3),
        (0,3,7), (0,7,4),
        (1,5,6), (1,6,2),
        (0,4,5), (0,5,1),
        (3,7,6), (3,6,2),
        (4,5,8),
        (7,6,9),
        (4,7,9), (4,9,8),
        (5,6,9), (5,9,8)
    ]
    return v, faces

def generate(type, size=1.0, segments=16, width=2.0, depth=2.0, height=1.5, roof_height=1.0, output="model.obj"):
    if type == "cube":
        v, f = cube(size)
    elif type == "sphere":
        v, f = sphere(size, segments)
    elif type == "house":
        v, f = house_mesh(width, depth, height, roof_height)
    else:
        raise ValueError(f"Unsupported type: {type}")
    write_obj(output, v, f)
    return {"vertices": len(v), "faces": len(f), "file": output}

@app.route('/', methods=['POST'])
def handle():
    data = request.get_json()
    if not data or 'command' not in data:
        return jsonify({"error": "Missing command"}), 400
    cmd = data['command']
    params = data.get('params', {})
    
    if cmd == "list_commands":
        return jsonify({
            "commands": [
                {
                    "name": "generate_model",
                    "description": "Generate a 3D model (cube, sphere, house) and save as OBJ",
                    "params": {
                        "type": {"type": "string", "enum": ["cube", "sphere", "house"], "required": True, "description": "Shape to generate"},
                        "size": {"type": "number", "default": 1.0, "description": "Size/radius for cube/sphere"},
                        "segments": {"type": "integer", "default": 16, "description": "Segments for sphere"},
                        "width": {"type": "number", "default": 2.0, "description": "House width"},
                        "depth": {"type": "number", "default": 2.0, "description": "House depth"},
                        "height": {"type": "number", "default": 1.5, "description": "House height"},
                        "roof_height": {"type": "number", "default": 1.0, "description": "House roof height"},
                        "output": {"type": "string", "default": "model.obj", "description": "Output filename"}
                    }
                }
            ]
        })
    elif cmd == "generate_model":
        try:
            result = generate(**params)
            return jsonify({"result": result})
        except Exception as e:
            return jsonify({"error": str(e)}), 400
    else:
        return jsonify({"error": f"Unknown command: {cmd}"}), 400

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
