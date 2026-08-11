import argparse
import math
import sys

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

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--type", required=True, choices=["cube","sphere","house"])
    p.add_argument("--size", type=float, default=1.0)
    p.add_argument("--segments", type=int, default=16)
    p.add_argument("--width", type=float, default=2.0)
    p.add_argument("--depth", type=float, default=2.0)
    p.add_argument("--height", type=float, default=1.5)
    p.add_argument("--roof_height", type=float, default=1.0)
    p.add_argument("--output", default="model.obj")
    args = p.parse_args()
    result = generate(args.type, args.size, args.segments, args.width, args.depth, args.height, args.roof_height, args.output)
    print(f"Generated {result['file']} with {result['vertices']} vertices and {result['faces']} faces")

if __name__ == "__main__":
    main()
