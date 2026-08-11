import argparse
import sys

def write_obj(filename, vertices, faces):
    with open(filename, 'w') as f:
        for v in vertices:
            f.write(f"v {v[0]:.6f} {v[1]:.6f} {v[2]:.6f}\n")
        for face in faces:
            if len(face) == 3:
                f.write(f"f {face[0]+1} {face[1]+1} {face[2]+1}\n")
            else:
                # split quad into two triangles
                f.write(f"f {face[0]+1} {face[1]+1} {face[2]+1}\n")
                f.write(f"f {face[0]+1} {face[2]+1} {face[3]+1}\n")

def house_mesh(width, depth, height, roof_height):
    w = width / 2.0
    d = depth / 2.0
    h = height
    rh = roof_height

    # Vertices
    v = [
        (-w, 0, -d),   # 0 bottom front left
        ( w, 0, -d),   # 1 bottom front right
        ( w, 0,  d),   # 2 bottom back right
        (-w, 0,  d),   # 3 bottom back left
        (-w, h, -d),   # 4 top front left
        ( w, h, -d),   # 5 top front right
        ( w, h,  d),   # 6 top back right
        (-w, h,  d),   # 7 top back left
        ( 0, h+rh, -d), # 8 ridge front
        ( 0, h+rh,  d)  # 9 ridge back
    ]

    # Faces (triangles and quads, quads will be split)
    faces = [
        # Bottom
        (0,1,2), (0,2,3),
        # Left side
        (0,3,7), (0,7,4),
        # Right side
        (1,5,6), (1,6,2),
        # Front side
        (0,4,5), (0,5,1),
        # Back side
        (3,7,6), (3,6,2),
        # Roof gables (triangles)
        (4,5,8),  # front gable
        (7,6,9),  # back gable
        # Roof left sloped face (quad)
        (4,7,9), (4,9,8),  # split into two triangles
        # Roof right sloped face (quad)
        (5,6,9), (5,9,8)   # split into two triangles
    ]

    return v, faces

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--width", type=float, default=2.0)
    p.add_argument("--depth", type=float, default=2.0)
    p.add_argument("--height", type=float, default=1.5)
    p.add_argument("--roof-height", type=float, default=1.0)
    p.add_argument("--output", default="house.obj")
    args = p.parse_args()

    v, f = house_mesh(args.width, args.depth, args.height, args.roof_height)
    write_obj(args.output, v, f)
    print(f"Generated {args.output} with {len(v)} vertices and {len(f)} faces")

if __name__ == "__main__":
    main()
