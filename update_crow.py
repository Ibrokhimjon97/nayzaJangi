import re

with open('public/client.js', 'r', encoding='utf-8') as f:
    text = f.read()

loader_code = """
let crowModelTemplate = null;
const gltfLoader = new THREE.GLTFLoader();
gltfLoader.load('3d models/crow.glb', (gltf) => {
    crowModelTemplate = gltf.scene;
    crowModelTemplate.scale.set(40, 40, 40); // Initial scale
    crowModelTemplate.traverse(child => { if (child.isMesh) { child.castShadow = true; } });
}, undefined, (e) => console.error(e));
"""

if 'gltfLoader = new THREE.GLTFLoader' not in text:
    text = text.replace('const socket = io();', 'const socket = io();\n' + loader_code)

original_create_crow = re.compile(r'function createCrow\(x, y\) \{[\s\S]*?return crowGroup;\n\}')

new_create_crow = """function createCrow(x, y) {
    const crowGroup = new THREE.Group();
    if (crowModelTemplate) {
        const model = crowModelTemplate.clone();
        model.rotation.y = Math.PI / 2; // Assuming the model faces Z or X, let's adjust
        crowGroup.add(model);
    } else {
        const body = new THREE.Mesh(new THREE.BoxGeometry(15, 10, 10), new THREE.MeshBasicMaterial({color: 0x111111}));
        crowGroup.add(body);
        const wingMat = new THREE.MeshBasicMaterial({color: 0x222222});
        const wingL = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 25), wingMat);
        wingL.position.set(0, 0, 12);
        crowGroup.add(wingL);
        const wingR = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 25), wingMat);
        wingR.position.set(0, 0, -12);
        crowGroup.add(wingR);
    }
    crowGroup.position.set(x, y, 0);
    return crowGroup;
}"""

text = original_create_crow.sub(new_create_crow, text)

with open('public/client.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Crow model injected successfully!")
